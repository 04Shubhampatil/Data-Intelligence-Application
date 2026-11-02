import type { Page } from "playwright";
import { syncOptionsSchema, type SyncOptions } from "@di/core";
import { prisma, type SyncStatus } from "@di/db";
import { getAdapter } from "../adapters";
import { AdapterError, type FilterKey, type SourceAdapter } from "../adapters/types";
import { installGuard } from "../browser/guard";
import { keepAwake } from "../browser/keep-awake";
import { launchBrowser } from "../browser/launch";
import { loadSession, saveSession } from "../browser/session";
import { loadAllowedDocumentKinds, loadAllowedFields } from "../pipeline/field-policy";
import type { Downloader } from "../pipeline/documents";
import { emptyCounters, processRecord, type Counters, type RecordContext } from "./process-record";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Employees read at the same time during a listing run (each on its own profile tab, each paced by
 * the source's rate limit). 3 by default; SYNC_PROFILE_CONCURRENCY=1 restores one-at-a-time; max 4.
 */
export function profileConcurrency(env = process.env.SYNC_PROFILE_CONCURRENCY): number {
  const n = Number(env ?? 3);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 4) : 3;
}

/** A listing request that dropped (no response, server error, rate limit) rather than a real failure. */
export function isTransientListingError(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /HTTP (0|429|5\d\d)\b|Failed to fetch|net::ERR_|timed? ?out|ECONNRESET|socket hang up/i.test(m);
}

/**
 * Retries fn on transient errors with growing pauses (default 5 s, 20 s, 60 s), so one network
 * blip on the listing no longer fails a many-hour job. Other errors are thrown at once.
 */
export async function retryTransient<T>(
  fn: () => Promise<T>,
  opts: { delaysMs?: number[]; isTransient?: (e: unknown) => boolean; sleep?: (ms: number) => Promise<unknown>; log?: (m: string) => void; label?: string } = {},
): Promise<T> {
  const delays = opts.delaysMs ?? [5_000, 20_000, 60_000];
  const transient = opts.isTransient ?? isTransientListingError;
  const wait = opts.sleep ?? sleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= delays.length || !transient(err)) throw err;
      opts.log?.(`${opts.label ?? "request"} failed (${err instanceof Error ? err.message.split("\n")[0].slice(0, 120) : "error"}); retrying in ${Math.round(delays[attempt] / 1000)} s`);
      await wait(delays[attempt]);
    }
  }
}

/**
 * Runs fn over items with up to `workers` in flight. Stops handing out new items once shouldStop()
 * is true or any item throws; waits for the in-flight ones, then rethrows the first error.
 */
export async function runPool<T>(items: readonly T[], workers: number, fn: (item: T, worker: number) => Promise<void>, shouldStop: () => boolean = () => false): Promise<void> {
  let next = 0;
  let failed = false;
  let firstError: unknown;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(workers, items.length)) }, async (_, w) => {
      while (!failed && !shouldStop() && next < items.length) {
        const item = items[next++];
        try {
          await fn(item, w);
        } catch (e) {
          if (!failed) firstError = e;
          failed = true;
        }
      }
    }),
  );
  if (failed) throw firstError;
}
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

  const releaseAwake = keepAwake(log);
  const browser = await launchBrowser({ headless: true });
  try {
    const context = await browser.newContext({ storageState: session });
    const guard = await installGuard(context, adapter.guardPolicy(conn.baseUrl));
    const page = await context.newPage();
    // One profile tab per parallel reader; the listing page (and its DataTables state) stays intact.
    const readers = isListingRun && options.includeProfiles ? profileConcurrency() : 1;
    const profilePages: Page[] = [];
    for (let i = 0; i < readers; i++) {
      const p = await context.newPage();
      // Profile pages pull ~100 images, map tiles and fonts the parser never needs (it reads image
      // addresses from the HTML; documents are downloaded separately). Skipping them makes each
      // profile much faster and lighter on the source. Scripts still run (the ticket table needs them).
      await p.route("**/*", (route) => (["image", "media", "font"].includes(route.request().resourceType()) ? route.abort() : route.fallback()));
      profilePages.push(p);
    }
    if (readers > 1) log(`reading ${readers} employees at a time`);

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

    const makeCtx = (profilePage: Page): RecordContext => ({
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
      fetchExtras: async (code, want) => {
        // Runs on the profile page fetchProfile just opened (same origin + session), paced like other requests.
        const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
        const out: { attendance?: Awaited<ReturnType<NonNullable<typeof adapter.fetchAttendance>>>; tickets?: Awaited<ReturnType<NonNullable<typeof adapter.fetchTickets>>> } = {};
        if (want.attendance && adapter.fetchAttendance) {
          await sleep(Math.min(conn.rateLimitMs, 1000));
          out.attendance = await adapter.fetchAttendance(profilePage, code, today.getFullYear(), today.getMonth() + 1);
        }
        if (want.tickets && adapter.fetchTickets) {
          await sleep(Math.min(conn.rateLimitMs, 1000));
          out.tickets = await adapter.fetchTickets(profilePage, code);
        }
        return out;
      },
    });
    const ctxs = profilePages.map(makeCtx);
    const ctx = ctxs[0];

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
      cancelled = await runListing(page, adapter, ctxs, options, counters, checkpoint ?? { start: 0 }, conn.rateLimitMs, jobId, heartbeat, log);
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
    releaseAwake();
  }
}

/** Pages through the listing from the checkpoint. Returns true if cancelled. */
async function runListing(
  page: Page,
  adapter: SourceAdapter,
  ctxs: RecordContext[],
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
    // Keep the counters in the checkpoint (they match this page boundary), or a resume restarts the count.
    if (await heartbeat({ start, counters: { ...counters } })) return true;
    await sleep(rateLimitMs);
    const length = Math.min(size, cap - start);
    const fetched = await retryTransient(() => adapter.fetchPage(page, { start, length, filters }), { log, label: `listing page at ${start}` });
    const t = fetched.total;
    // The source may ignore small page sizes and return more rows than asked — enforce the cap ourselves.
    const rows = fetched.rows.slice(0, Math.max(0, Math.min(length, cap - start)));
    if (total === Infinity) {
      total = t;
      await prisma.syncJob.update({ where: { id: jobId }, data: { totalRecords: Math.min(t, cap) } });
      log(`listing reports ${t} record(s)${Number.isFinite(cap) ? `, capped at ${cap}` : ""}`);
    }
    if (!rows.length) break;
    // Several employees at once, one per profile tab. The checkpoint only moves after the whole page
    // is done, so a pause or cancel mid-page re-reads that page on resume (records are idempotent).
    let cancelled = false;
    let lastBeat = counters.processed;
    await runPool(
      rows,
      ctxs.length,
      async (row, w) => {
        await processRecord(ctxs[w], row, counters);
        // Check for cancel/heartbeat every 10 records while reading profiles (they're slow).
        if (options.includeProfiles && counters.processed - lastBeat >= 10) {
          lastBeat = counters.processed;
          if (await heartbeat()) cancelled = true;
        }
      },
      () => cancelled,
    );
    if (cancelled) return true;
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
