/** Document pipeline against MySQL + a temp storage dir, with a fake downloader (no network). */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalFileStorage, type DocumentKind } from "@di/core";

const hasDb = !!process.env.DATABASE_URL;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, 0, 0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const HTML = new TextEncoder().encode("<html><body>not an image at all</body></html>");

describe.skipIf(!hasDb)("document pipeline", async () => {
  const { prisma } = await import("@di/db");
  const { syncDocuments } = await import("../src/pipeline/documents");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "di-files-"));
  const storage = new LocalFileStorage(tmp);
  const TAG = `ZZDOC${Date.now()}`;
  let sourceId = "";
  let candidateId = "";
  const allowed = new Set<DocumentKind>(["PROFILE_PHOTO", "SSC_CERTIFICATE"]);
  const files: Record<string, { status: number; bytes: Uint8Array } | null> = {
    "https://resourcedata.in/user_data_uploads/profile_photos/p.jpg": { status: 200, bytes: JPEG },
    "https://resourcedata.in/user_data_uploads/ssc_certificate_photo/s.png": { status: 200, bytes: PNG },
    "https://resourcedata.in/user_data_uploads/ssc_certificate_photo/gone.jpg": null,
    "https://resourcedata.in/user_data_uploads/ssc_certificate_photo/bad.jpg": { status: 200, bytes: HTML },
  };
  const download = async (url: string) => {
    if (!(url in files)) throw new Error("unexpected url " + url);
    return files[url];
  };
  const doc = (kind: DocumentKind, url: string) => ({ kind, url, originalName: url.split("/").pop()!, missing: false });

  beforeAll(async () => {
    sourceId = (await prisma.sourceConnection.create({ data: { name: TAG, adapterKey: "synthetic", baseUrl: "https://example.test" } })).id;
    candidateId = (await prisma.candidate.create({ data: { sourceConnectionId: sourceId, sourceEmployeeCode: "D1", fullName: "Doc Person", contentHash: "h", lastSyncedAt: new Date() } })).id;
  });
  afterAll(async () => {
    await prisma.candidate.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.sourceConnection.delete({ where: { id: sourceId } });
    rmSync(tmp, { recursive: true, force: true });
  });

  it("stores allowed kinds with sniffed type + hash, skips disallowed kinds, records missing/unsupported", async () => {
    const c = await syncDocuments({
      candidateId,
      allowed,
      download,
      storage,
      documents: [
        doc("PROFILE_PHOTO", "https://resourcedata.in/user_data_uploads/profile_photos/p.jpg"),
        doc("SSC_CERTIFICATE", "https://resourcedata.in/user_data_uploads/ssc_certificate_photo/s.png"),
        doc("AADHAAR_FRONT", "https://resourcedata.in/user_data_uploads/aadhaar_front_photo/a.jpg"), // not allowed → never downloaded
      ],
    });
    expect(c).toMatchObject({ stored: 2, skipped: 1, failed: 0, missing: 0 });
    const rows = await prisma.candidateDocument.findMany({ where: { candidateId }, orderBy: { kind: "asc" } });
    expect(rows.map((r) => [r.kind, r.status, r.mimeType])).toEqual([
      ["PROFILE_PHOTO", "STORED", "image/jpeg"],
      ["SSC_CERTIFICATE", "STORED", "image/png"],
    ]);
    for (const r of rows) {
      expect(r.storageKey).toMatch(/^candidates\//);
      expect(await storage.exists(r.storageKey!)).toBe(true);
      expect(r.sourceRef).not.toBe(r.storageKey);
    }
    expect(await prisma.candidateDocument.count({ where: { candidateId, kind: "AADHAAR_FRONT" } })).toBe(0);

    // Re-sync with the same URLs: nothing re-downloaded.
    const again = await syncDocuments({
      candidateId,
      allowed,
      storage,
      download: async () => {
        throw new Error("should not download");
      },
      documents: [doc("PROFILE_PHOTO", "https://resourcedata.in/user_data_uploads/profile_photos/p.jpg")],
    });
    expect(again).toMatchObject({ unchanged: 1, stored: 0 });

    // Source replaced the certificate with a non-image, then removed it.
    const bad = await syncDocuments({ candidateId, allowed, download, storage, documents: [doc("SSC_CERTIFICATE", "https://resourcedata.in/user_data_uploads/ssc_certificate_photo/bad.jpg")] });
    expect(bad.failed).toBe(1);
    expect((await prisma.candidateDocument.findUniqueOrThrow({ where: { candidateId_kind_slot: { candidateId, kind: "SSC_CERTIFICATE", slot: 0 } } })).status).toBe("UNSUPPORTED");
    const gone = await syncDocuments({ candidateId, allowed, download, storage, documents: [doc("SSC_CERTIFICATE", "https://resourcedata.in/user_data_uploads/ssc_certificate_photo/gone.jpg")] });
    expect(gone.missing).toBe(1);
  });
});
