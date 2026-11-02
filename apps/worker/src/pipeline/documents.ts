import {
  DOCUMENT_DEFS,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MIME_EXT,
  documentAad,
  documentKey,
  encryptBytes,
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

export type DocumentCounters = { stored: number; unchanged: number; missing: number; skipped: number; failed: number; retryLater?: number };
export const emptyDocCounters = (): DocumentCounters => ({ stored: 0, unchanged: 0, missing: 0, skipped: 0, failed: 0 });

/** Transient failures are retried later; after MAX_ATTEMPTS the document is left FAILED until its source URL changes. */
export const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];

/** Network trouble or server-side errors (5xx / 429) — worth retrying. Anything else is permanent. */
export function isTransientDownloadError(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /timeout|timed out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|net::ERR_|HTTP (5\d\d|429)/i.test(m);
}

class PermanentError extends Error {}

/**
 * Copies the documents a profile references into private storage — only kinds switched on in
 * DocumentPolicy. Per file: real type sniffed from the bytes (JPEG/PNG/WEBP/PDF), size capped
 * (DOCUMENT_MAX_MB), SHA-256 content hash, optional ClamAV scan, identity/bank kinds encrypted
 * (AES-256-GCM). Unchanged source URLs are not downloaded again; identical content is stored once.
 * Transient failures get one quick retry, then backoff across runs (1 h, 6 h, 24 h).
 */
export async function syncDocuments(
  opts: {
    candidateId: string;
    documents: SourceDocument[];
    allowed: ReadonlySet<DocumentKind>;
    download: Downloader;
    storage?: FileStorage;
    log?: (m: string) => void;
    now?: () => Date;
    sleep?: (ms: number) => Promise<void>;
  },
  counters: DocumentCounters = emptyDocCounters(),
): Promise<DocumentCounters> {
  const storage = opts.storage ?? new LocalFileStorage();
  const now = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  for (const doc of opts.documents) {
    if (!opts.allowed.has(doc.kind)) {
      counters.skipped++;
      continue;
    }
    const slot = doc.slot ?? 0;
    const where = { candidateId_kind_slot: { candidateId: opts.candidateId, kind: doc.kind, slot } };
    const existing = await prisma.candidateDocument.findUnique({ where });
    const base = {
      candidateId: opts.candidateId,
      kind: doc.kind,
      slot,
      originalName: doc.originalName.slice(0, 200),
      sourceRef: doc.url,
      sourceVerification: doc.sourceVerification ?? null,
      lastSyncedAt: now(),
    };

    // Same file as last time → nothing to download (verification label may still change).
    if (existing && existing.sourceRef === doc.url && existing.status === "STORED") {
      await prisma.candidateDocument.update({ where, data: { sourceVerification: base.sourceVerification, lastSyncedAt: base.lastSyncedAt } });
      counters.unchanged++;
      continue;
    }
    // Same URL that failed before: respect the backoff, and stop after MAX_ATTEMPTS.
    if (existing && existing.sourceRef === doc.url && existing.status === "FAILED") {
      if (existing.attempts >= MAX_ATTEMPTS || (existing.nextRetryAt && existing.nextRetryAt > now())) {
        counters.retryLater = (counters.retryLater ?? 0) + 1;
        continue;
      }
    }
    const attemptsSoFar = existing && existing.sourceRef === doc.url ? existing.attempts : 0;

    try {
      let res: Awaited<ReturnType<Downloader>>;
      try {
        res = await opts.download(doc.url);
        if (res && res.status >= 500) throw new Error(`HTTP ${res.status}`);
      } catch (first) {
        if (!isTransientDownloadError(first)) throw first;
        await sleep(2_000); // one quick in-run retry
        res = await opts.download(doc.url);
      }
      if (!res) {
        await prisma.candidateDocument.upsert({ where, update: { ...base, status: "MISSING_AT_SOURCE", error: null, attempts: 0, nextRetryAt: null }, create: { ...base, status: "MISSING_AT_SOURCE" } });
        counters.missing++;
        continue;
      }
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (res.status !== 200) throw new PermanentError(`HTTP ${res.status}`);
      if (res.bytes.length > DOCUMENT_MAX_BYTES) {
        const error = `File larger than ${Math.round(DOCUMENT_MAX_BYTES / 1024 / 1024)} MB`;
        await prisma.candidateDocument.upsert({ where, update: { ...base, status: "UNSUPPORTED", error }, create: { ...base, status: "UNSUPPORTED", error } });
        counters.failed++;
        continue;
      }
      const mime = sniffMime(res.bytes);
      if (!mime || !DOCUMENT_MIME_EXT[mime]) {
        await prisma.candidateDocument.upsert({ where, update: { ...base, status: "UNSUPPORTED", error: "Unsupported file type" }, create: { ...base, status: "UNSUPPORTED", error: "Unsupported file type" } });
        counters.failed++;
        continue;
      }
      const sha = sha256Hex(res.bytes);
      const scan = await scanBytes(res.bytes);
      if (scan.result === "infected") {
        const data = { ...base, status: "QUARANTINED" as const, sha256: sha, mimeType: mime, sizeBytes: res.bytes.length, scanStatus: "infected", error: scan.detail?.slice(0, 200) ?? null, storageKey: null };
        await prisma.candidateDocument.upsert({ where, update: data, create: data });
        opts.log?.(`document ${doc.kind}#${slot} for ${opts.candidateId} quarantined`);
        counters.failed++;
        continue;
      }

      const encrypted = DOCUMENT_DEFS[doc.kind].identity;
      const ext = DOCUMENT_MIME_EXT[mime] + (encrypted ? ".enc" : "");
      const storageKey = documentKey(opts.candidateId, doc.kind, sha, ext);
      if (!(await storage.exists(storageKey))) {
        await storage.put(storageKey, encrypted ? encryptBytes(res.bytes, documentAad(opts.candidateId, doc.kind, sha)) : res.bytes);
      }
      // Remove the previous file only if no other row still points at it (identical files are shared).
      if (existing?.storageKey && existing.storageKey !== storageKey) {
        const stillUsed = await prisma.candidateDocument.count({ where: { storageKey: existing.storageKey, NOT: { id: existing.id } } });
        if (!stillUsed) await storage.delete(existing.storageKey).catch(() => {});
      }
      const data = {
        ...base,
        status: "STORED" as const,
        mimeType: mime,
        sizeBytes: res.bytes.length,
        sha256: sha,
        storageKey,
        encrypted,
        scanStatus: scan.result,
        error: null,
        attempts: 0,
        nextRetryAt: null,
        extractedAt: now(),
      };
      await prisma.candidateDocument.upsert({ where, update: data, create: data });
      counters.stored++;
    } catch (err) {
      const message = err instanceof Error ? err.message.split("\n")[0].slice(0, 200) : "download failed";
      const transient = !(err instanceof PermanentError) && isTransientDownloadError(err);
      const attempts = attemptsSoFar + 1;
      const nextRetryAt = transient && attempts < MAX_ATTEMPTS ? new Date(now().getTime() + BACKOFF_MS[attempts - 1]) : null;
      const failure = {
        ...base,
        status: "FAILED" as const,
        error: `${message}${transient ? (nextRetryAt ? ` — retry after ${nextRetryAt.toISOString()}` : " — gave up after 3 attempts") : ""}`.slice(0, 250),
        attempts: transient ? attempts : MAX_ATTEMPTS,
        nextRetryAt,
      };
      await prisma.candidateDocument.upsert({ where, update: failure, create: failure });
      counters.failed++;
    }
  }
  return counters;
}

/** Candidates with documents whose transient failure is due for another try (for the retry-documents run). */
export async function candidatesWithRetryableDocuments(sourceConnectionId: string, now = new Date()): Promise<string[]> {
  const rows = await prisma.candidateDocument.findMany({
    where: { status: "FAILED", attempts: { lt: MAX_ATTEMPTS }, OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }], candidate: { sourceConnectionId } },
    select: { candidate: { select: { sourceEmployeeCode: true } } },
    distinct: ["candidateId"],
    take: 5_000,
  });
  return rows.map((r) => r.candidate.sourceEmployeeCode);
}
