import { normalizeEmployeeCode, type DocumentKind, type FieldKey, type SyncOptions } from "@di/core";
import { prisma } from "@di/db";
import { AdapterError, type ProfileRead, type RawRecord } from "../adapters/types";
import { syncDocuments, type Downloader, type DocumentCounters } from "../pipeline/documents";
import { carryOverProfileFields, getExistingCandidate, persistRecord, prepareRecord, ValidationFailure } from "../pipeline/persist";

export type Counters = { processed: number; created: number; updated: number; unchanged: number; failed: number; skipped?: number; documents?: DocumentCounters };
export const emptyCounters = (): Counters => ({ processed: 0, created: 0, updated: 0, unchanged: 0, failed: 0 });

export type RecordContext = {
  sourceConnectionId: string;
  jobId: string;
  allowed: ReadonlySet<FieldKey>;
  options: SyncOptions;
  profileFields: readonly FieldKey[];
  /** Reads the profile page for one code. Throws AdapterError("SESSION_EXPIRED") to stop the job. */
  fetchProfile: (code: string) => Promise<ProfileRead>;
  /** Document kinds switched on for this source; empty = download nothing. */
  allowedDocuments?: ReadonlySet<DocumentKind>;
  download?: Downloader;
  log?: (m: string) => void;
  /** Employee codes erased on request — never stored again, never counted as failures. */
  suppressed?: ReadonlySet<string>;
  now?: () => Date;
};

async function logError(jobId: string, stage: string, message: string, code: string | null) {
  await prisma.syncError.create({ data: { syncJobId: jobId, stage, message: message.slice(0, 500), sourceEmployeeCode: code } });
}

/**
 * One listing row → (optional profile) → allow-list → validate → upsert.
 * Never throws for a bad record (it's logged and counted); only a lost
 * session propagates so the whole job can pause and be resumed.
 */
export async function processRecord(ctx: RecordContext, fromListing: RawRecord, counters: Counters): Promise<void> {
  counters.processed++;
  const code = normalizeEmployeeCode(fromListing.sourceEmployeeCode);
  if (!code) {
    counters.failed++;
    await logError(ctx.jobId, "VALIDATION", "Validation failed for: sourceEmployeeCode", null);
    return;
  }

  if (ctx.suppressed?.has(code)) {
    counters.skipped = (counters.skipped ?? 0) + 1;
    return;
  }

  const existing = await getExistingCandidate(ctx.sourceConnectionId, code);
  const now = ctx.now?.() ?? new Date();
  const needsProfileFields = ctx.profileFields.some((f) => ctx.allowed.has(f));
  const stale =
    !existing?.profileSyncedAt || now.getTime() - existing.profileSyncedAt.getTime() > ctx.options.profileMaxAgeDays * 86_400_000;
  const readProfile = ctx.options.includeProfiles && needsProfileFields && stale;

  let fromProfile: RawRecord = {};
  let documents: ProfileRead["documents"] = [];
  let profileSynced = false;
  if (readProfile) {
    try {
      const read = await ctx.fetchProfile(code);
      fromProfile = read.record;
      documents = read.documents;
      profileSynced = true;
    } catch (err) {
      if (err instanceof AdapterError && err.code === "SESSION_EXPIRED") throw err;
      // Keep going with listing data; the profile can be retried later.
      await logError(ctx.jobId, "PROFILE", err instanceof Error ? err.message.split("\n")[0] : "Profile read failed", code);
    }
  }

  try {
    let record = prepareRecord({ ...fromListing, ...fromProfile }, ctx.allowed);
    if (!profileSynced) record = carryOverProfileFields(record, existing, ctx.allowed);
    const { outcome, candidateId } = await persistRecord(ctx.sourceConnectionId, record, ctx.allowed, ctx.jobId, { profileSynced });
    counters[outcome === "CREATED" ? "created" : outcome === "UPDATED" ? "updated" : "unchanged"]++;
    if (profileSynced && documents.length && ctx.download && ctx.allowedDocuments?.size) {
      counters.documents ??= { stored: 0, unchanged: 0, missing: 0, skipped: 0, failed: 0 };
      await syncDocuments({ candidateId, documents, allowed: ctx.allowedDocuments, download: ctx.download, log: ctx.log }, counters.documents);
    }
  } catch (err) {
    counters.failed++;
    const stage = err instanceof ValidationFailure ? "VALIDATION" : "DB";
    const message = err instanceof ValidationFailure ? err.message : err instanceof Error ? err.message.split("\n")[0] : "Unknown error";
    await logError(ctx.jobId, stage, message, code);
  }
}
