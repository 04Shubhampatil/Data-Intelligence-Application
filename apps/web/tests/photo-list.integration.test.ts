/** Profile photos in candidate lists (MySQL, synthetic data, cleaned up). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CurrentUser } from "@/server/auth/session";

const hasDb = !!process.env.DATABASE_URL;
const TAG = `ZZPHOTO${Date.now()}`;

describe.skipIf(!hasDb)("profile photos in lists", async () => {
  const { prisma } = await import("@di/db");
  const { listCandidates } = await import("@/server/services/candidate.service");
  const { candidateFilterSchema } = await import("@/lib/validation/candidates");
  const { verifyDocumentSignature } = await import("@/server/documents/signing");

  let sourceId = "", dA = "", dB = "", withPhoto = "", noPhoto = "", other = "", photoDocId = "";
  const user = (perms: string[], scope: string[]): CurrentUser => ({ id: "u-photo-test", email: "p@example.test", name: "P", role: "DISTRICT_ADMIN", permissions: perms as CurrentUser["permissions"], districtScopeIds: scope });
  const list = (u: CurrentUser) => listCandidates(candidateFilterSchema.parse({ q: TAG, pageSize: 25 }), u);

  beforeAll(async () => {
    sourceId = (await prisma.sourceConnection.create({ data: { name: TAG, adapterKey: "synthetic", baseUrl: "https://example.test" } })).id;
    dA = (await prisma.district.create({ data: { name: `${TAG} A` } })).id;
    dB = (await prisma.district.create({ data: { name: `${TAG} B` } })).id;
    const mk = async (code: string, districtId: string) => (await prisma.candidate.create({ data: { sourceConnectionId: sourceId, sourceEmployeeCode: code, fullName: `${TAG} ${code}`, districtId, contentHash: "h", lastSyncedAt: new Date() } })).id;
    withPhoto = await mk("H0001", dA);
    noPhoto = await mk("H0002", dA);
    other = await mk("H0003", dB);
    photoDocId = (await prisma.candidateDocument.create({ data: { candidateId: withPhoto, kind: "PROFILE_PHOTO", status: "STORED", originalName: "p.jpg", storageKey: "candidates/x/PROFILE_PHOTO/abc.jpg", sourceRef: "https://resourcedata.in/p.jpg" } })).id;
    await prisma.candidateDocument.create({ data: { candidateId: noPhoto, kind: "PROFILE_PHOTO", status: "MISSING_AT_SOURCE", originalName: "p.jpg", sourceRef: "https://resourcedata.in/q.jpg" } });
    await prisma.candidateDocument.create({ data: { candidateId: other, kind: "PROFILE_PHOTO", status: "STORED", originalName: "p.jpg", storageKey: "candidates/y/PROFILE_PHOTO/def.jpg", sourceRef: "https://resourcedata.in/r.jpg" } });
  });
  afterAll(async () => {
    await prisma.candidate.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.sourceConnection.delete({ where: { id: sourceId } });
    await prisma.district.deleteMany({ where: { name: { startsWith: TAG } } });
  });

  it("stored photos get a signed, user-bound link; missing ones fall back to the silhouette", async () => {
    const u = user(["candidates:read", "documents:read"], [dA]);
    const r = await list(u);
    const byId = new Map(r.rows.map((x) => [x.id, x.photoUrl]));
    expect([...byId.keys()].sort()).toEqual([withPhoto, noPhoto].sort()); // district B never listed
    expect(byId.get(noPhoto)).toBeNull();
    const url = new URL(`http://localhost${byId.get(withPhoto)}`);
    expect(url.pathname).toBe(`/api/documents/${photoDocId}`);
    expect(verifyDocumentSignature(photoDocId, u.id, url.searchParams.get("e"), url.searchParams.get("s"), true)).toBe(true);
    expect(verifyDocumentSignature(photoDocId, "someone-else", url.searchParams.get("e"), url.searchParams.get("s"), true)).toBe(false);
  });

  it("users without documents:read get no photo links at all", async () => {
    const r = await list(user(["candidates:read"], [dA]));
    expect(r.rows.every((x) => x.photoUrl === null)).toBe(true);
  });
});
