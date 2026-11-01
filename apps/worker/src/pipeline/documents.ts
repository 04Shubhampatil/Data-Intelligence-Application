import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MIME_EXT,
  documentKey,
  LocalFileStorage,
  scanBytes,
  sha256Hex,
  sniffMime,
  type DocumentKind,
  type FileStorage,
} from "@di/core";
import { prisma } from "@di/db";
import type { SourceDocument } from "../adapters/types";

/** GET a source file. Returns null when the source answers 404/410 (treated as missing). */
export type Downloader = (url: string) => Promise<{ status: number; bytes: Uint8Array } | null>;

export type DocumentCounters = { stored: number; unchanged: number; missing: number; skipped: number; failed: number };
export const emptyDocCounters = (): DocumentCounters => ({ stored: 0, unchanged: 0, missing: 0, skipped: 0, failed: 0 });

/**
 * Copies the documents a profile references into private storage — only kinds that are
 * switched on in DocumentPolicy. Type is sniffed from bytes, size capped, content hashed,
 * optionally scanned. Re-syncs skip files whose source URL hasn't changed.
 */
export async function syncDocuments(
  opts: { candidateId: string; documents: SourceDocument[]; allowed: ReadonlySet<DocumentKind>; download: Downloader; storage?: FileStorage; log?: (m: string) => void },
  counters: DocumentCounters = emptyDocCounters(),
): Promise<DocumentCounters> {
  const storage = opts.storage ?? new LocalFileStorage();
  for (const doc of opts.documents) {
    if (!opts.allowed.has(doc.kind)) {
      counters.skipped++;
      continue;
    }
    const key = { candidateId_kind: { candidateId: opts.candidateId, kind: doc.kind } };
    const existing = await prisma.candidateDocument.findUnique({ where: key });
    if (existing && existing.sourceRef === doc.url && existing.status === "STORED") {
      counters.unchanged++;
      continue;
    }
    const base = { candidateId: opts.candidateId, kind: doc.kind, originalName: doc.originalName.slice(0, 200), sourceRef: doc.url };

    try {
      const res = await opts.download(doc.url);
      if (!res) {
        await prisma.candidateDocument.upsert({ where: key, update: { ...base, status: "MISSING_AT_SOURCE", error: null }, create: { ...base, status: "MISSING_AT_SOURCE" } });
        counters.missing++;
        continue;
      }
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      if (res.bytes.length > DOCUMENT_MAX_BYTES) {
        await prisma.candidateDocument.upsert({ where: key, update: { ...base, status: "UNSUPPORTED", error: "File larger than 15 MB" }, create: { ...base, status: "UNSUPPORTED", error: "File larger than 15 MB" } });
        counters.failed++;
        continue;
      }
      const mime = sniffMime(res.bytes);
      if (!mime || !DOCUMENT_MIME_EXT[mime]) {
        await prisma.candidateDocument.upsert({ where: key, update: { ...base, status: "UNSUPPORTED", error: "Unsupported file type" }, create: { ...base, status: "UNSUPPORTED", error: "Unsupported file type" } });
        counters.failed++;
        continue;
      }
      const scan = await scanBytes(res.bytes);
      const sha = sha256Hex(res.bytes);
      if (scan.result === "infected") {
        await prisma.candidateDocument.upsert({
          where: key,
          update: { ...base, status: "QUARANTINED", sha256: sha, mimeType: mime, sizeBytes: res.bytes.length, scanStatus: "infected", error: scan.detail?.slice(0, 200), storageKey: null },
          create: { ...base, status: "QUARANTINED", sha256: sha, mimeType: mime, sizeBytes: res.bytes.length, scanStatus: "infected", error: scan.detail?.slice(0, 200) },
        });
        opts.log?.(`document ${doc.kind} for ${opts.candidateId} quarantined (${scan.detail})`);
        counters.failed++;
        continue;
      }
      const storageKey = documentKey(opts.candidateId, doc.kind, sha, DOCUMENT_MIME_EXT[mime]);
      if (!(await storage.exists(storageKey))) await storage.put(storageKey, res.bytes);
      if (existing?.storageKey && existing.storageKey !== storageKey) await storage.delete(existing.storageKey).catch(() => {});
      const data = { ...base, status: "STORED" as const, mimeType: mime, sizeBytes: res.bytes.length, sha256: sha, storageKey, scanStatus: scan.result, error: null, extractedAt: new Date() };
      await prisma.candidateDocument.upsert({ where: key, update: data, create: data });
      counters.stored++;
    } catch (err) {
      const message = err instanceof Error ? err.message.split("\n")[0].slice(0, 200) : "download failed";
      await prisma.candidateDocument.upsert({ where: key, update: { ...base, status: "FAILED", error: message }, create: { ...base, status: "FAILED", error: message } });
      counters.failed++;
    }
  }
  return counters;
}
