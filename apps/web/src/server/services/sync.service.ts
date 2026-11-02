import "server-only";
import { STALE_JOB_MS, syncOptionsSchema, describeSync, type SyncOptions } from "@di/core";
import { prisma } from "@di/db";

export type SourceFilterOption = { value: string; label: string };

export async function getSources() {
  const sources = await prisma.sourceConnection.findMany({
    where: { isActive: true, adapterKey: { not: "synthetic" } },
    select: {
      id: true, name: true, baseUrl: true, authMode: true, sessionSavedAt: true, lastSyncedAt: true, sourceFilters: true,
      fieldPolicies: { select: { fieldKey: true, allowed: true }, orderBy: { fieldKey: "asc" } },
    },
  });
  return sources.map((s) => {
    const f = (s.sourceFilters ?? {}) as { district?: SourceFilterOption[]; departmentHead?: SourceFilterOption[] };
    return { ...s, districts: f.district ?? [], departmentHeads: f.departmentHead ?? [] };
  });
}

export function jobOptions(filters: unknown): SyncOptions | null {
  const parsed = syncOptionsSchema.safeParse(filters ?? {});
  return parsed.success ? parsed.data : null;
}

export function jobLabel(filters: unknown) {
  const o = jobOptions(filters);
  if (!o) return "Prototype (one record)";
  return describeSync(o);
}

export function isActive(job: { status: string; heartbeatAt: Date | null }) {
  if (job.status === "QUEUED") return true;
  return job.status === "RUNNING" && !!job.heartbeatAt && Date.now() - job.heartbeatAt.getTime() < STALE_JOB_MS;
}

/** A job can be resumed if it stopped part-way through a listing run. */
export function isResumable(job: { status: string; heartbeatAt: Date | null; checkpoint: unknown; filters: unknown }) {
  const o = jobOptions(job.filters);
  if (!o || o.kind === "retry" || o.kind === "one") return false;
  const stale = job.status === "RUNNING" && !isActive(job);
  return ["FAILED", "AWAITING_MFA", "CANCELLED"].includes(job.status) || stale;
}

export async function getJob(id: string) {
  return prisma.syncJob.findUnique({
    where: { id },
    include: {
      sourceConnection: { select: { id: true, name: true } },
      triggeredBy: { select: { name: true, email: true } },
      errors: { orderBy: { createdAt: "desc" }, take: 200 },
    },
  });
}

export async function getRecentJobs(take = 20) {
  return prisma.syncJob.findMany({
    orderBy: { createdAt: "desc" },
    take,
    include: { sourceConnection: { select: { name: true } }, errors: { where: { resolvedAt: null }, select: { stage: true, message: true }, take: 1 } },
  });
}

// ───────────── Schedules & worker status (Phase 8) ─────────────

export async function listSchedules() {
  return prisma.syncSchedule.findMany({
    orderBy: [{ enabled: "desc" }, { nextRunAt: "asc" }],
    include: { sourceConnection: { select: { name: true } }, createdBy: { select: { name: true, email: true } } },
  });
}

export const WORKER_STALE_MS = 60_000;

export async function getWorkerStatus() {
  const row = await prisma.systemStatus.findUnique({ where: { key: "worker" } });
  if (!row) return { online: false as const, seenAt: null, currentJobId: null };
  const v = row.value as { seenAt?: string; currentJobId?: string | null; host?: string };
  const seenAt = v.seenAt ? new Date(v.seenAt) : row.updatedAt;
  return { online: Date.now() - seenAt.getTime() < WORKER_STALE_MS, seenAt, currentJobId: v.currentJobId ?? null, host: v.host };
}


/** Request-time checks used by server pages (kept out of render so pages stay pure). */
export function isLockedNow(lockedUntil: Date | null | undefined): boolean {
  return !!lockedUntil && lockedUntil.getTime() > Date.now();
}

export function isQueuedTooLong(job: { status: string; createdAt: Date } | undefined, ms = 15_000): boolean {
  return job?.status === "QUEUED" && Date.now() - job.createdAt.getTime() > ms;
}
