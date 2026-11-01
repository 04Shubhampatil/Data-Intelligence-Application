/** Scheduler against MySQL with a SYNTHETIC source (cleaned up afterwards). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("scheduler (MySQL)", async () => {
  const { prisma } = await import("@di/db");
  const { runDueSchedules, recordScheduleOutcome } = await import("../src/jobs/scheduler");
  const TAG = `ZZSCH-${Date.now()}`;
  let sourceId = "";

  beforeAll(async () => {
    sourceId = (await prisma.sourceConnection.create({ data: { name: TAG, adapterKey: "synthetic", baseUrl: "https://example.test" } })).id;
  });
  afterAll(async () => {
    await prisma.syncJob.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.syncSchedule.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.sourceConnection.delete({ where: { id: sourceId } });
  });

  it("queues a SCHEDULED job for a due schedule exactly once and advances nextRunAt", async () => {
    const past = new Date(Date.now() - 60_000);
    const s = await prisma.syncSchedule.create({
      data: { sourceConnectionId: sourceId, name: `${TAG} daily`, frequency: "DAILY", hour: 2, minute: 0, options: { kind: "full", includeProfiles: false }, nextRunAt: past },
    });
    const first = await runDueSchedules(new Date());
    const mine = await prisma.syncJob.findMany({ where: { scheduleId: s.id } });
    expect(mine).toHaveLength(1);
    expect(first).toContain(mine[0].id);
    expect(mine[0]).toMatchObject({ mode: "SCHEDULED", status: "QUEUED" });

    const after = await prisma.syncSchedule.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(after.lastJobId).toBe(mine[0].id);

    // Not due any more → nothing happens.
    expect(await runDueSchedules(new Date())).not.toContain(mine[0].id);
    expect(await prisma.syncJob.count({ where: { scheduleId: s.id } })).toBe(1);

    // Outcome is mirrored onto the schedule.
    await prisma.syncJob.update({ where: { id: mine[0].id }, data: { status: "SUCCEEDED" } });
    await recordScheduleOutcome(mine[0].id);
    expect((await prisma.syncSchedule.findUniqueOrThrow({ where: { id: s.id } })).lastStatus).toBe("SUCCEEDED");
  });

  it("skips (but still advances) when a job is already active for the source", async () => {
    const s = await prisma.syncSchedule.create({
      data: { sourceConnectionId: sourceId, name: `${TAG} hourly`, frequency: "HOURLY", minute: 0, options: { kind: "full" }, nextRunAt: new Date(Date.now() - 1000) },
    });
    // The QUEUED job from the previous test was marked SUCCEEDED; create a fresh active one.
    const active = await prisma.syncJob.create({ data: { sourceConnectionId: sourceId, status: "RUNNING", heartbeatAt: new Date() } });
    await runDueSchedules(new Date());
    expect(await prisma.syncJob.count({ where: { scheduleId: s.id } })).toBe(0);
    const after = await prisma.syncSchedule.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    await prisma.syncJob.update({ where: { id: active.id }, data: { status: "SUCCEEDED" } });
  });

  it("disabled schedules are never run", async () => {
    const s = await prisma.syncSchedule.create({
      data: { sourceConnectionId: sourceId, name: `${TAG} off`, frequency: "HOURLY", options: { kind: "full" }, enabled: false, nextRunAt: new Date(Date.now() - 1000) },
    });
    await runDueSchedules(new Date());
    expect(await prisma.syncJob.count({ where: { scheduleId: s.id } })).toBe(0);
  });
});
