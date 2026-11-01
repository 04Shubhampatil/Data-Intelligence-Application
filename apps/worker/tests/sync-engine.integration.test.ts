/**
 * Sync engine integration tests (MySQL, SYNTHETIC data only, cleaned up afterwards).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultAllowedFields, syncOptionsSchema } from "@di/core";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("sync engine (MySQL)", async () => {
  const { prisma } = await import("@di/db");
  const { processRecord, emptyCounters } = await import("../src/jobs/process-record");
  const { AdapterError } = await import("../src/adapters/types");
  const { enqueueJob, claimNextJob, hasActiveJob } = await import("@di/db/sync-queue");
  const { mahahrdAdapter } = await import("../src/adapters/mahahrd");

  const TAG = `ZZENGINE-${Date.now()}`;
  let sourceId = "";
  let jobId = "";

  beforeAll(async () => {
    sourceId = (await prisma.sourceConnection.create({ data: { name: TAG, adapterKey: "synthetic", baseUrl: "https://example.test" } })).id;
    jobId = (await prisma.syncJob.create({ data: { sourceConnectionId: sourceId, status: "RUNNING" } })).id;
  });

  afterAll(async () => {
    await prisma.syncJob.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.candidate.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.sourceConnection.delete({ where: { id: sourceId } });
    for (const m of ["subProject", "departmentHead", "department", "designation", "district"] as const) {
      await (prisma[m] as unknown as { deleteMany(a: object): Promise<unknown> }).deleteMany({ where: { name: { startsWith: TAG } } });
    }
  });

  const listingRow = (code: string, extra: Record<string, unknown> = {}) => ({
    sourceEmployeeCode: code,
    fullName: "SYNTHETIC PERSON",
    district: `${TAG} D`,
    departmentHead: `${TAG} P`,
    designation: `${TAG} G`,
    ...extra,
  });
  const profile = { taluka: "Testpur", joiningDate: "15 Jan 2024", sourceStatus: "Active", docVerificationStatus: "VERIFIED" };

  function ctx(overrides: Partial<Parameters<typeof processRecord>[0]> = {}) {
    const calls: string[] = [];
    return {
      calls,
      ctx: {
        sourceConnectionId: sourceId,
        jobId,
        allowed: defaultAllowedFields(),
        options: syncOptionsSchema.parse({ kind: "full" }),
        profileFields: mahahrdAdapter.profileFields,
        fetchProfile: async (code: string) => {
          calls.push(code);
          return { record: profile, documents: [] };
        },
        ...overrides,
      },
    };
  }

  it("reads the profile for a new record, then skips it while fresh — and the record stays UNCHANGED", async () => {
    const counters = emptyCounters();
    const a = ctx();
    await processRecord(a.ctx, listingRow("E910001"), counters);
    expect(a.calls).toEqual(["E910001"]);
    expect(counters).toMatchObject({ processed: 1, created: 1 });

    const b = ctx();
    await processRecord(b.ctx, listingRow("E910001"), counters);
    expect(b.calls).toEqual([]); // fresh → not re-read
    expect(counters.unchanged).toBe(1); // carried-over profile fields → same hash

    const c = await prisma.candidate.findFirstOrThrow({ where: { sourceConnectionId: sourceId, sourceEmployeeCode: "E910001" } });
    expect(c).toMatchObject({ taluka: "TESTPUR", sourceStatus: "Active", docVerificationStatus: "VERIFIED" });
    expect(c.profileSyncedAt).not.toBeNull();
  });

  it("a list-only run never blanks stored profile fields", async () => {
    const counters = emptyCounters();
    const { ctx: c } = ctx({ options: syncOptionsSchema.parse({ kind: "full", includeProfiles: false }) });
    await processRecord(c, listingRow("E910001"), counters);
    expect(counters.unchanged).toBe(1);
    const row = await prisma.candidate.findFirstOrThrow({ where: { sourceConnectionId: sourceId, sourceEmployeeCode: "E910001" } });
    expect(row.taluka).toBe("TESTPUR");
  });

  it("re-reads stale profiles (maxAge 0) and detects a real change as UPDATED", async () => {
    const counters = emptyCounters();
    const a = ctx({
      options: syncOptionsSchema.parse({ kind: "full", profileMaxAgeDays: 0 }),
      now: () => new Date(Date.now() + 1000),
      fetchProfile: async () => ({ record: { ...profile, sourceStatus: "Resigned" }, documents: [] }),
    });
    await processRecord(a.ctx, listingRow("E910001"), counters);
    expect(counters.updated).toBe(1);
  });

  it("a failed profile read is logged but the listing data is still stored", async () => {
    const counters = emptyCounters();
    const { ctx: c } = ctx({ fetchProfile: async () => Promise.reject(new Error("timeout")) });
    await processRecord(c, listingRow("E910002"), counters);
    expect(counters).toMatchObject({ created: 1, failed: 0 });
    const errs = await prisma.syncError.findMany({ where: { syncJobId: jobId, sourceEmployeeCode: "E910002" } });
    expect(errs.map((e) => e.stage)).toEqual(["PROFILE"]);
  });

  it("a lost session stops the job instead of being swallowed", async () => {
    const { ctx: c } = ctx({ fetchProfile: async () => Promise.reject(new AdapterError("SESSION_EXPIRED", "expired")) });
    await expect(processRecord(c, listingRow("E910003"), emptyCounters())).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it("invalid rows are counted and logged without values", async () => {
    const counters = emptyCounters();
    const { ctx: c } = ctx();
    await processRecord(c, listingRow("not-a-code", { fullName: "SECRET NAME" }), counters);
    expect(counters.failed).toBe(1);
    const err = await prisma.syncError.findFirstOrThrow({ where: { syncJobId: jobId, stage: "VALIDATION" }, orderBy: { createdAt: "desc" } });
    expect(err.message).not.toContain("SECRET");
  });

  it("queue: one active job per source, atomic claim, stale jobs reclaimable", async () => {
    await prisma.syncJob.update({ where: { id: jobId }, data: { status: "SUCCEEDED" } });
    const opts = syncOptionsSchema.parse({ kind: "full", maxRecords: 1 });
    const job = await enqueueJob(sourceId, opts);
    expect(await hasActiveJob(sourceId)).toBe(true);
    await expect(enqueueJob(sourceId, opts)).rejects.toThrow(/already queued or running/);

    const otherQueued = await prisma.syncJob.count({ where: { status: "QUEUED", id: { not: job.id } } });
    if (otherQueued === 0) {
      expect(await claimNextJob()).toBe(job.id);
      expect(await claimNextJob()).toBeNull(); // already claimed

      // Simulate a dead worker: heartbeat 10 minutes old → reclaimable, and no longer "active".
      await prisma.syncJob.update({ where: { id: job.id }, data: { heartbeatAt: new Date(Date.now() - 10 * 60_000) } });
      expect(await hasActiveJob(sourceId)).toBe(false);
      expect(await claimNextJob()).toBe(job.id);
    }
    await prisma.syncJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED" } });
  });
});
