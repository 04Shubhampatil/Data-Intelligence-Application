import { normalizeEmployeeCode, type DocumentKind, type FieldKey, type SyncOptions } from "@di/core";
import { prisma } from "@di/db";
import { AdapterError, type AttendanceMonth, type ProfileRead, type RawRecord, type TicketRow } from "../adapters/types";
import { saveAttendance, saveOfficeLocation, saveSensitiveGroups, saveTickets } from "../pipeline/extras";
import { syncDocuments, type Downloader, type DocumentCounters } from "../pipeline/documents";
import { carryOverProfileFields, getExistingCandidate, persistRecord, prepareRecord, savePersonalDetails, ValidationFailure } from "../pipeline/persist";

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
  /**
   * Attendance (current month) and the ticket list for one code, read from the profile page that
   * fetchProfile just opened. Only called for approved sections; omitted in tests that don't need it.
   */
  fetchExtras?: (code: string, want: { attendance: boolean; tickets: boolean }) => Promise<{ attendance?: AttendanceMonth | null; tickets?: TicketRow[] }>;
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
  let personal: ProfileRead["personal"];
  let sensitive: ProfileRead["sensitive"];
  let officeLocation: ProfileRead["officeLocation"];
  let profileSynced = false;
  if (readProfile) {
    try {
      const read = await ctx.fetchProfile(code);
      fromProfile = read.record;
      documents = read.documents;
      personal = read.personal;
      sensitive = read.sensitive;
      officeLocation = read.officeLocation;
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
    // Personal details only change when the profile page was actually read; otherwise the stored copy stays.
    if (profileSynced) {
      // Each section is saved on its own: one failing section never loses the others or the record.
      const step = async (stage: string, fn: () => Promise<unknown>) => {
        try {
          await fn();
        } catch (err) {
          if (err instanceof AdapterError && err.code === "SESSION_EXPIRED") throw err;
          await logError(ctx.jobId, stage, err instanceof Error ? err.message.split("\n")[0].slice(0, 200) : `${stage} not saved`, code);
        }
      };
      await step("PERSONAL", () => savePersonalDetails(candidateId, personal, ctx.allowed));
      await step("SENSITIVE", () => saveSensitiveGroups(candidateId, sensitive, ctx.allowed, now));
      await step("PROFILE", () => saveOfficeLocation(candidateId, officeLocation, ctx.allowed));
      const want = { attendance: ctx.allowed.has("attendance"), tickets: ctx.allowed.has("tickets") };
      if (ctx.fetchExtras && (want.attendance || want.tickets)) {
        await step("EXTRAS", async () => {
          const extras = await ctx.fetchExtras!(code, want);
          if (want.attendance && extras.attendance) await saveAttendance(candidateId, extras.attendance, now);
          if (want.tickets && extras.tickets) await saveTickets(candidateId, extras.tickets, now);
        });
      }
      if (documents.length && ctx.download && ctx.allowedDocuments?.size) {
        counters.documents ??= { stored: 0, unchanged: 0, missing: 0, skipped: 0, failed: 0 };
        await step("DOCUMENTS", async () => {
          await syncDocuments({ candidateId, documents, allowed: ctx.allowedDocuments!, download: ctx.download!, log: ctx.log }, counters.documents);
          await prisma.candidate.update({ where: { id: candidateId }, data: { documentsSyncedAt: now } });
        });
      }
    }
  } catch (err) {
    // A lost session must stop the whole job (it pauses for re-login and resumes), never count as one bad record.
    if (err instanceof AdapterError && err.code === "SESSION_EXPIRED") throw err;
    counters.failed++;
    const stage = err instanceof ValidationFailure ? "VALIDATION" : "DB";
    const message = err instanceof ValidationFailure ? err.message : err instanceof Error ? err.message.split("\n")[0] : "Unknown error";
    await logError(ctx.jobId, stage, message, code);
  }
}
