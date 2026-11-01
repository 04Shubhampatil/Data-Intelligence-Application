/** Retention cleanup + erasure against MySQL with SYNTHETIC rows (cleaned up afterwards). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("retention & erasure (MySQL)", async () => {
  const { prisma } = await import("../src/index");
  const { runRetentionCleanup, eraseCandidate, retentionSettingsSchema } = await import("../src/retention");
  const TAG = `ZZRET${Date.now()}`;
  let sourceId = "";
  const old = new Date(Date.now() - 400 * 86_400_000);

  beforeAll(async () => {
    sourceId = (await prisma.sourceConnection.create({ data: { name: TAG, adapterKey: "synthetic", baseUrl: "https://example.test" } })).id;
  });
  afterAll(async () => {
    await prisma.syncJob.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.candidate.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.suppressedRecord.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.sourceConnection.delete({ where: { id: sourceId } });
  });

  it("deletes only data older than the configured periods, never active jobs or live candidates", async () => {
    const live = await prisma.candidate.create({ data: { sourceConnectionId: sourceId, sourceEmployeeCode: "Q1", fullName: "Live", contentHash: "h", lastSyncedAt: old } });
    const gone = await prisma.candidate.create({ data: { sourceConnectionId: sourceId, sourceEmployeeCode: "Q2", fullName: "Gone", contentHash: "h", lastSyncedAt: old, isDeletedAtSource: true } });
    const recentGone = await prisma.candidate.create({ data: { sourceConnectionId: sourceId, sourceEmployeeCode: "Q3", fullName: "Gone recently", contentHash: "h", lastSyncedAt: new Date(), isDeletedAtSource: true } });
    const oldJob = await prisma.syncJob.create({ data: { sourceConnectionId: sourceId, status: "SUCCEEDED", createdAt: old } });
    const oldActive = await prisma.syncJob.create({ data: { sourceConnectionId: sourceId, status: "AWAITING_MFA", createdAt: old } });

    const settings = retentionSettingsSchema.parse({ syncLogDays: 90, auditLogDays: 0, assistantResultDays: 0, reportRunDays: 0, removedAtSourcePurgeDays: 30 });
    const r = await runRetentionCleanup(new Date(), settings);
    expect(r.syncJobs).toBeGreaterThanOrEqual(1);
    expect(r.purgedCandidates).toBeGreaterThanOrEqual(1);

    expect(await prisma.candidate.findUnique({ where: { id: live.id } })).not.toBeNull();
    expect(await prisma.candidate.findUnique({ where: { id: recentGone.id } })).not.toBeNull();
    expect(await prisma.candidate.findUnique({ where: { id: gone.id } })).toBeNull();
    expect(await prisma.syncJob.findUnique({ where: { id: oldJob.id } })).toBeNull();
    expect(await prisma.syncJob.findUnique({ where: { id: oldActive.id } })).not.toBeNull();
  });

  it("0 means keep forever", async () => {
    const r = await runRetentionCleanup(new Date(), retentionSettingsSchema.parse({ syncLogDays: 0, auditLogDays: 0, assistantResultDays: 0, reportRunDays: 0, removedAtSourcePurgeDays: 0 }));
    expect(r).toMatchObject({ syncJobs: 0, auditLogs: 0, assistantResults: 0, reportRuns: 0, purgedCandidates: 0 });
  });

  it("erasure removes the record, its contact data and log rows, and blocks the code", async () => {
    const c = await prisma.candidate.create({ data: { sourceConnectionId: sourceId, sourceEmployeeCode: "Q9", fullName: "Erase Me", contentHash: "h", lastSyncedAt: new Date() } });
    await prisma.candidateProfile.create({ data: { candidateId: c.id, mobile: "+919000000009" } });
    const job = await prisma.syncJob.create({ data: { sourceConnectionId: sourceId, status: "SUCCEEDED" } });
    await prisma.syncRecord.create({ data: { syncJobId: job.id, candidateId: c.id, sourceEmployeeCode: "Q9", outcome: "CREATED" } });

    const r = await eraseCandidate({ sourceConnectionId: sourceId, sourceEmployeeCode: "q9", reason: "test" });
    expect(r).toMatchObject({ code: "Q9", deletedCandidate: true, syncRecords: 1 });
    expect(await prisma.candidate.findUnique({ where: { id: c.id } })).toBeNull();
    expect(await prisma.candidateProfile.findUnique({ where: { candidateId: c.id } })).toBeNull();
    expect(await prisma.suppressedRecord.findFirst({ where: { sourceConnectionId: sourceId, sourceEmployeeCode: "Q9" } })).not.toBeNull();

    // Erasing an unknown code still blocks it (idempotent).
    const again = await eraseCandidate({ sourceConnectionId: sourceId, sourceEmployeeCode: "Q9" });
    expect(again.deletedCandidate).toBe(false);
  });
});
