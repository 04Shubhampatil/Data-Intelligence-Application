import { launchBrowser } from "../browser/launch";
import type { FieldKey } from "@di/core";
import { prisma } from "@di/db";
import { getAdapter } from "../adapters";
import { AdapterError, type RawRecord } from "../adapters/types";
import { installGuard, type GuardStats } from "../browser/guard";
import { loadSession, saveSession } from "../browser/session";
import { loadAllowedFields } from "../pipeline/field-policy";
import { persistRecord, prepareRecord, ValidationFailure, type Outcome } from "../pipeline/persist";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ExtractOneResult =
  | { ok: true; jobId: string; outcome: Outcome; candidateId: string; stored: Record<string, unknown>; guard: GuardStats; sourceTotal: number }
  | { ok: false; jobId: string; stage: string; message: string; guard?: GuardStats };

/**
 * Phase 3 prototype: extract exactly ONE record end-to-end.
 * listing → (profile, only if an allow-listed field needs it) → allow-list → validate → upsert.
 */
export async function extractOne(opts: { connectionId: string; code?: string; headed?: boolean }): Promise<ExtractOneResult> {
  const conn = await prisma.sourceConnection.findUniqueOrThrow({ where: { id: opts.connectionId } });
  const adapter = getAdapter(conn.adapterKey);
  const allowed = await loadAllowedFields(conn.id);

  const job = await prisma.syncJob.create({
    data: { sourceConnectionId: conn.id, mode: "MANUAL", status: "RUNNING", startedAt: new Date(), totalRecords: 1, filters: { prototype: true, code: opts.code ?? "first" } },
  });

  const fail = async (stage: string, message: string, code?: string | null, guard?: GuardStats): Promise<ExtractOneResult> => {
    await prisma.syncError.create({ data: { syncJobId: job.id, stage, message, sourceEmployeeCode: code ?? null } });
    await prisma.syncJob.update({ where: { id: job.id }, data: { status: "FAILED", failed: 1, processed: 1, finishedAt: new Date() } });
    return { ok: false, jobId: job.id, stage, message, guard };
  };

  const session = await loadSession(conn.id);
  if (!session) return fail("LOGIN", "No saved session. Run the login step first (npm run login -w @di/worker).");

  const browser = await launchBrowser({ headless: !opts.headed });
  let guard: GuardStats | undefined;
  let stage = "LISTING";
  let code: string | null = opts.code ?? null;
  try {
    const context = await browser.newContext({ storageState: session });
    guard = await installGuard(context, adapter.guardPolicy(conn.baseUrl));
    const page = await context.newPage();

    const { total } = await adapter.openListing(page, conn.baseUrl);
    await sleep(conn.rateLimitMs);

    const fromListing: RawRecord = opts.code ? await adapter.findInListing(page, opts.code) : await adapter.firstInListing(page);
    code = String(fromListing.sourceEmployeeCode ?? code ?? "");

    let fromProfile: RawRecord = {};
    if (adapter.profileFields.some((f: FieldKey) => allowed.has(f))) {
      stage = "PROFILE";
      await sleep(conn.rateLimitMs);
      fromProfile = (await adapter.readProfile(page, conn.baseUrl, code)).record;
    }

    stage = "VALIDATION";
    const record = prepareRecord({ ...fromListing, ...fromProfile }, allowed);

    stage = "DB";
    const { outcome, candidateId } = await persistRecord(conn.id, record, allowed, job.id, { profileSynced: Object.keys(fromProfile).length > 0 });

    await saveSession(conn.id, context); // keep rotated cookies
    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: "SUCCEEDED",
        processed: 1,
        created: outcome === "CREATED" ? 1 : 0,
        updated: outcome === "UPDATED" ? 1 : 0,
        unchanged: outcome === "UNCHANGED" ? 1 : 0,
        finishedAt: new Date(),
      },
    });
    await prisma.sourceConnection.update({ where: { id: conn.id }, data: { lastSyncedAt: new Date() } });

    return { ok: true, jobId: job.id, outcome, candidateId, stored: record, guard, sourceTotal: total };
  } catch (err) {
    if (err instanceof AdapterError) return fail(err.code === "SESSION_EXPIRED" ? "LOGIN" : stage, err.message, code, guard);
    if (err instanceof ValidationFailure) return fail("VALIDATION", err.message, code, guard);
    const msg = err instanceof Error ? err.message.split("\n")[0].slice(0, 300) : "Unknown error";
    return fail(stage, msg, code, guard);
  } finally {
    await browser.close();
  }
}
