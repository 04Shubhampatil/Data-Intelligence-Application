import { STALE_JOB_MS, syncOptionsSchema, type SyncOptions } from "@di/core";
import { prisma } from "./index";

/**
 * Database-backed job queue (Phase 4). The web app inserts QUEUED jobs; the
 * worker claims them atomically. Schedules (Phase 8) are database-backed too; no Redis needed.
 */

/** Atomically claims the oldest QUEUED job (or a RUNNING one whose worker died). */
export async function claimNextJob(): Promise<string | null> {
  const staleBefore = new Date(Date.now() - STALE_JOB_MS);
  const candidates = await prisma.syncJob.findMany({
    where: { OR: [{ status: "QUEUED" }, { status: "RUNNING", heartbeatAt: { lt: staleBefore } }] },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, heartbeatAt: true },
    take: 5,
  });
  for (const c of candidates) {
    const { count } = await prisma.syncJob.updateMany({
      where: { id: c.id, status: c.status, heartbeatAt: c.heartbeatAt }, // optimistic lock
      data: { status: "RUNNING", heartbeatAt: new Date() },
    });
    if (count === 1) return c.id;
  }
  return null;
}

/** True if this connection already has a job that is queued or actively running. */
export async function hasActiveJob(sourceConnectionId: string) {
  const staleBefore = new Date(Date.now() - STALE_JOB_MS);
  const n = await prisma.syncJob.count({
    where: {
      sourceConnectionId,
      OR: [{ status: "QUEUED" }, { status: "RUNNING", heartbeatAt: { gte: staleBefore } }],
    },
  });
  return n > 0;
}

export async function enqueueJob(sourceConnectionId: string, options: SyncOptions, extra: { triggeredById?: string; retryOfJobId?: string; claimNow?: boolean } = {}) {
  if (await hasActiveJob(sourceConnectionId)) throw new Error("A sync is already queued or running for this source.");
  const parsed = syncOptionsSchema.parse(options);
  return prisma.syncJob.create({
    data: {
      sourceConnectionId,
      status: extra.claimNow ? "RUNNING" : "QUEUED",
      heartbeatAt: extra.claimNow ? new Date() : null,
      mode: parsed.kind === "retry" ? "RETRY" : "MANUAL",
      filters: parsed,
      triggeredById: extra.triggeredById,
      retryOfJobId: extra.retryOfJobId,
    },
  });
}
