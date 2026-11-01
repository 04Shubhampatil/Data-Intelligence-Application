import { computeNextRun, scheduleSpecSchema, syncOptionsSchema } from "@di/core";
import { prisma } from "@di/db";
import { enqueueJob, hasActiveJob } from "@di/db/sync-queue";

const TZ = process.env.TZ || "Asia/Kolkata";

/**
 * Queues jobs for schedules that are due. Safe with several workers: a schedule is
 * claimed by moving its nextRunAt forward in a conditional update, so only one wins.
 * Returns the ids of jobs it queued.
 */
export async function runDueSchedules(now = new Date(), log: (m: string) => void = () => {}): Promise<string[]> {
  const due = await prisma.syncSchedule.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
    take: 10,
  });
  const queued: string[] = [];

  for (const s of due) {
    const spec = scheduleSpecSchema.parse({ frequency: s.frequency, minute: s.minute, hour: s.hour, weekday: s.weekday });
    const nextRunAt = computeNextRun(spec, now, TZ);
    // Claim: only the worker that advances nextRunAt from its current value proceeds.
    const { count } = await prisma.syncSchedule.updateMany({ where: { id: s.id, nextRunAt: s.nextRunAt }, data: { nextRunAt } });
    if (count !== 1) continue;

    if (await hasActiveJob(s.sourceConnectionId)) {
      log(`schedule "${s.name}" skipped — a sync is already running; next at ${nextRunAt.toISOString()}`);
      continue;
    }
    try {
      const options = syncOptionsSchema.parse(s.options);
      const job = await prisma.syncJob.create({
        data: { sourceConnectionId: s.sourceConnectionId, status: "QUEUED", mode: "SCHEDULED", filters: options, scheduleId: s.id, triggeredById: s.createdById },
      });
      await prisma.syncSchedule.update({ where: { id: s.id }, data: { lastRunAt: now, lastJobId: job.id, lastStatus: "QUEUED" } });
      queued.push(job.id);
      log(`schedule "${s.name}" queued job ${job.id}; next at ${nextRunAt.toISOString()}`);
    } catch (err) {
      log(`schedule "${s.name}" failed to queue: ${err instanceof Error ? err.message : err}`);
    }
  }
  return queued;
}

/** Mirrors a finished job's status onto its schedule (for the Sync page). */
export async function recordScheduleOutcome(jobId: string) {
  const job = await prisma.syncJob.findUnique({ where: { id: jobId }, select: { scheduleId: true, status: true } });
  if (!job?.scheduleId) return;
  await prisma.syncSchedule.updateMany({ where: { id: job.scheduleId, lastJobId: jobId }, data: { lastStatus: job.status } });
}

export { enqueueJob };
