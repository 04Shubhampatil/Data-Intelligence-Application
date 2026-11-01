import type { Page } from "playwright";
import { syncOptionsSchema, type SyncOptions } from "@di/core";
import { prisma, type SyncStatus } from "@di/db";
import { getAdapter } from "../adapters";
import { AdapterError, type FilterKey, type SourceAdapter } from "../adapters/types";
import { installGuard } from "../browser/guard";
import { launchBrowser } from "../browser/launch";
import { loadSession, saveSession } from "../browser/session";
import { loadAllowedDocumentKinds, loadAllowedFields } from "../pipeline/field-policy";
import type { Downloader } from "../pipeline/documents";
import { emptyCounters, processRecord, type Counters, type RecordContext } from "./process-record";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Resume point. Counters are snapshotted with it so a resumed run never double-counts the page it was on. */
type Checkpoint = { start: number; counters?: Counters };

export type RunLog = (msg: string) => void;

/**
 * Runs (or resumes) one sync job end-to-end. Safe to call on a job that was
 * interrupted: it continues from the stored checkpoint and keeps its counters.
 */
export async function runSyncJob(jobId: string, log: RunLog = console.log): Promise<SyncStatus> {
  const job = await prisma.syncJob.findUniqueOrThrow({ where: { id: jobId }, include: { sourceConnection: true } });
  const conn = job.sourceConnection;
  const adapter = getAdapter(conn.adapterKey);
  const options = syncOptionsSchema.parse(job.filters ?? {});
  const allowed = await loadAllowedFields(conn.id);
  const allowedDocuments = await loadAllowedDocumentKinds(conn.id);
  const checkpoint = (job.checkpoint as Checkpoint | null) ?? null;
  const isListingRun = options.kind === "full" || options.kind === "filtered";
  // Listing runs restart from the last completed page, so take the counters as they were at that point.
  const counters: Counters = isListingRun
    ? { ...emptyCounters(), ...(checkpoint?.counters ?? {}) }
    : { processed: job.processed, created: job.created, updated: job.updated, unchanged: job.unchanged, failed: job.failed };

  const dbCounters = () => ({ processed: counters.processed, created: counters.created, updated: counters.updated, unchanged: counters.unchanged, failed: counters.failed });
  const finish = async (status: SyncStatus, extra: Record<string, unknown> = {}) => {
    await prisma.syncJob.update({ where: { id: jobId }, data: { status, ...dbCounters(), finishedAt: new Date(), heartbeatAt: new Date(), ...extra } });
    if (status === "SUCCEEDED" || status === "PARTIAL") {
      // Job-level errors from earlier attempts (timeouts, expired session) are moot once the job completes.
      await prisma.syncError.updateMany({ where: { syncJobId: jobId, sourceEmployeeCode: null, resolvedAt: null }, data: { resolvedAt: new Date() } });
    }
    log(`job ${jobId} → ${status} (${JSON.stringify(counters)})`);
    return status;
  };
  const stageError = (stage: string, message: string) =>
    prisma.syncError.create({ data: { syncJobId: jobId, stage, message: message.slice(0, 500) } });

  await prisma.syncJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: job.startedAt ?? new Date(), heartbeatAt: new Date(), finishedAt: null },
  });

  const session = await loadSession(conn.id);
  if (!session) {
    await stageError("LOGIN", "Not signed in to the source. Run `npm run source:login`, then resume this job.");
    return finish("AWAITING_MFA");
  }

  const browser = await launchBrowser({ headless: true });
  try {
    const context = await browser.newContext({ storageState: session });
    const guard = await installGuard(context, adapter.guardPolicy(conn.baseUrl));
    const page = await context.newPage();
    const profilePage = await context.newPage(); // keep the listing page (and its DataTables state) intact

    await adapter.openListing(page, conn.baseUrl);
    const sourceFilters = await adapter.readFilterOptions(page);
    await prisma.sourceConnection.update({ where: { id: conn.id }, data: { sourceFilters } });

    const suppressed = new Set((await prisma.suppressedRecord.findMany({ where: { sourceConnectionId: conn.id }, select: { sourceEmployeeCode: true } })).map((r) => r.sourceEmployeeCode));
    if (suppressed.size) log(`${suppressed.size} erased code(s) will be skipped`);

    // Document downloads: GET only, allow-listed hosts only, through the same session.
    const download: Downloader = async (url) => {
      const u = new URL(url);
      if (!adapter.documentHosts.includes(u.hostname)) throw new Error(`host ${u.hostname} not allowed`);
      await sleep(Math.min(conn.rateLimitMs, 1000));
      const res = await context.request.get(url, { timeout: 30_000, maxRedirects: 2 });
      if (res.status() === 404 || res.status() === 410) return null;
      return { status: res.status(), bytes: new Uint8Array(await res.body()) };
    };

    const ctx: RecordContext = {
      sourceConnectionId: conn.id,
      suppressed,
      allowedDocuments,
      download,
      log,
      jobId,
      allowed,
      options,
      profileFields: adapter.profileFields,
      fetchProfile: async (code) => {
        await sleep(conn.rateLimitMs);
        return adapter.readProfile(profilePage, conn.baseUrl, code);
      },
    };

    const heartbeat = async (checkpoint?: Checkpoint) => {
      const fresh = await prisma.syncJob.update({
        where: { id: jobId },
        data: { ...dbCounters(), heartbeatAt: new Date(), ...(checkpoint ? { checkpoint } : {}) },
        select: { cancelRequested: true },
      });
      return fresh.cancelRequested;
    };

    let cancelled = false;
    let completedAll = false;

    if (options.kind === "retry" || options.kind === "one") {
      await prisma.syncJob.update({ where: { id: jobId }, data: { totalRecords: options.codes.length } });
      for (const code of options.codes) {
        if (await heartbeat()) {
          cancelled = true;
          break;
        }
        await sleep(conn.rateLimitMs);
        try {
          const row = await adapter.findInListing(page, code);
          await processRecord(ctx, row, counters);
        } catch (err) {
          if (err instanceof AdapterError && err.code === "SESSION_EXPIRED") throw err;
          counters.processed++;
          counters.failed++;
          await prisma.syncError.create({
            data: { syncJobId: jobId, stage: "LISTING", sourceEmployeeCode: code, message: err instanceof Error ? err.message.split("\n")[0] : "Lookup failed" },
          });
        }
      }
      if (!cancelled) await resolveRetriedErrors(job.retryOfJobId, jobId);
    } else {
      cancelled = await runListing(page, adapter, ctx, options, counters, checkpoint ?? { start: 0 }, conn.rateLimitMs, jobId, heartbeat, log);
      completedAll = !cancelled;
    }

    await saveSession(conn.id, context);
    if (guard.blocked.length) log(`guard blocked ${guard.blocked.length} request(s): ${[...new Set(guard.blocked.map((b) => b.path))].join(", ")}`);

    if (cancelled) return finish("CANCELLED");

    // Only a complete, unfiltered, uncapped run can tell us which records disappeared at the source.
    if (completedAll && options.kind === "full" && !options.maxRecords && !options.filters.district && !options.filters.departmentHead) {
      const gone = await prisma.candidate.updateMany({
        where: { sourceConnectionId: conn.id, isDeletedAtSource: false, lastSyncedAt: { lt: job.startedAt ?? job.createdAt } },
        data: { isDeletedAtSource: true },
      });
      if (gone.count) log(`marked ${gone.count} record(s) as removed at source`);
    }
    await prisma.sourceConnection.update({ where: { id: conn.id }, data: { lastSyncedAt: new Date() } });
    return finish(counters.failed ? "PARTIAL" : "SUCCEEDED");
  } catch (err) {
    if (err instanceof AdapterError && err.code === "SESSION_EXPIRED") {
      await stageError("LOGIN", "Source session expired. Sign in again (`npm run source:login`), then resume — progress is kept.");
      return finish("AWAITING_MFA");
    }
    const msg = err instanceof Error ? err.message.split("\n")[0] : "Unknown error";
    await stageError(err instanceof AdapterError && err.code === "LAYOUT_CHANGED" ? "LAYOUT" : "JOB", msg);
    return finish("FAILED");
  } finally {
    await browser.close();
  }
}

/** Pages through the listing from the checkpoint. Returns true if cancelled. */
async function runListing(
  page: Page,
  adapter: SourceAdapter,
  ctx: RecordContext,
  options: SyncOptions,
  counters: Counters,
  checkpoint: Checkpoint,
  rateLimitMs: number,
  jobId: string,
  heartbeat: (c?: Checkpoint) => Promise<boolean>,
  log: RunLog,
): Promise<boolean> {
  const filters: Partial<Record<FilterKey, string>> = {
    district: options.filters.district?.value,
    departmentHead: options.filters.departmentHead?.value,
  };
  const size = adapter.pageSize;
  let start = checkpoint.start;
  let total = Infinity;
  const cap = options.maxRecords || Infinity;

  while (start < total && start < cap) {
    if (await heartbeat({ start })) return true;
    await sleep(rateLimitMs);
    const length = Math.min(size, cap - start);
    const fetched = await adapter.fetchPage(page, { start, length, filters });
    const t = fetched.total;
    // The source may ignore small page sizes and return more rows than asked — enforce the cap ourselves.
    const rows = fetched.rows.slice(0, Math.max(0, Math.min(length, cap - start)));
    if (total === Infinity) {
      total = t;
      await prisma.syncJob.update({ where: { id: jobId }, data: { totalRecords: Math.min(t, cap) } });
      log(`listing reports ${t} record(s)${Number.isFinite(cap) ? `, capped at ${cap}` : ""}`);
    }
    if (!rows.length) break;
    for (const row of rows) {
      await processRecord(ctx, row, counters);
      // Check for cancel/heartbeat every 10 records while reading profiles (they're slow).
      if (options.includeProfiles && counters.processed % 10 === 0 && (await heartbeat())) return true;
    }
    start += rows.length;
    await heartbeat({ start, counters: { ...counters } });
    log(`… ${Math.min(start, total)} / ${Math.min(total, cap)}`);
  }
  return false;
}

/** After a successful retry job, mark the original job's errors for those codes as resolved. */
async function resolveRetriedErrors(originalJobId: string | null, retryJobId: string) {
  if (!originalJobId) return;
  const stillFailing = await prisma.syncError.findMany({
    where: { syncJobId: retryJobId, sourceEmployeeCode: { not: null } },
    select: { sourceEmployeeCode: true },
  });
  const failingCodes = stillFailing.map((e) => e.sourceEmployeeCode!) ;
  await prisma.syncError.updateMany({
    where: { syncJobId: originalJobId, resolvedAt: null, sourceEmployeeCode: { not: null, notIn: failingCodes } },
    data: { resolvedAt: new Date() },
  });
  await prisma.syncError.updateMany({
    where: { syncJobId: originalJobId, resolvedAt: null, sourceEmployeeCode: { in: failingCodes } },
    data: { retryCount: { increment: 1 } },
  });
}
