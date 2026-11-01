import { z } from "zod";
import { prisma } from "./index";

/**
 * Data retention & deletion. Settings live in SystemStatus (key "retention");
 * cleanup runs from the worker daily and from Settings on demand.
 * All periods are in days; 0 means "keep forever".
 */
export const retentionSettingsSchema = z.object({
  syncLogDays: z.coerce.number().int().min(0).max(3650).default(90), // SyncJob + records + errors
  auditLogDays: z.coerce.number().int().min(0).max(3650).default(365),
  assistantResultDays: z.coerce.number().int().min(0).max(3650).default(30),
  reportRunDays: z.coerce.number().int().min(0).max(3650).default(365),
  /** Candidates flagged as removed at the source are hard-deleted after this many days. */
  removedAtSourcePurgeDays: z.coerce.number().int().min(0).max(3650).default(30),
});
export type RetentionSettings = z.infer<typeof retentionSettingsSchema>;

const KEY = "retention";

export async function getRetentionSettings(): Promise<RetentionSettings> {
  const row = await prisma.systemStatus.findUnique({ where: { key: KEY } });
  const parsed = retentionSettingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : retentionSettingsSchema.parse({});
}

export async function saveRetentionSettings(input: unknown): Promise<RetentionSettings> {
  const value = retentionSettingsSchema.parse(input);
  await prisma.systemStatus.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } });
  return value;
}

export type CleanupResult = {
  ranAt: string;
  syncJobs: number;
  auditLogs: number;
  assistantResults: number;
  reportRuns: number;
  purgedCandidates: number;
};

const ago = (days: number, now: Date) => new Date(now.getTime() - days * 86_400_000);

/** Applies the retention settings. Never touches active jobs or live candidates. */
export async function runRetentionCleanup(now = new Date(), settings?: RetentionSettings): Promise<CleanupResult> {
  const s = settings ?? (await getRetentionSettings());
  const result: CleanupResult = { ranAt: now.toISOString(), syncJobs: 0, auditLogs: 0, assistantResults: 0, reportRuns: 0, purgedCandidates: 0 };

  if (s.syncLogDays) {
    // SyncRecord and SyncError cascade from SyncJob.
    result.syncJobs = (
      await prisma.syncJob.deleteMany({ where: { createdAt: { lt: ago(s.syncLogDays, now) }, status: { notIn: ["QUEUED", "RUNNING", "AWAITING_MFA"] } } })
    ).count;
  }
  if (s.auditLogDays) result.auditLogs = (await prisma.auditLog.deleteMany({ where: { createdAt: { lt: ago(s.auditLogDays, now) } } })).count;
  if (s.assistantResultDays) result.assistantResults = (await prisma.assistantResult.deleteMany({ where: { createdAt: { lt: ago(s.assistantResultDays, now) } } })).count;
  if (s.reportRunDays) result.reportRuns = (await prisma.reportRun.deleteMany({ where: { createdAt: { lt: ago(s.reportRunDays, now) } } })).count;
  if (s.removedAtSourcePurgeDays) {
    result.purgedCandidates = (
      await prisma.candidate.deleteMany({ where: { isDeletedAtSource: true, lastSyncedAt: { lt: ago(s.removedAtSourcePurgeDays, now) } } })
    ).count;
  }

  await prisma.systemStatus.upsert({ where: { key: "retention:last" }, update: { value: result }, create: { key: "retention:last", value: result } });
  return result;
}

export async function getLastCleanup(): Promise<CleanupResult | null> {
  const row = await prisma.systemStatus.findUnique({ where: { key: "retention:last" } });
  return (row?.value as CleanupResult | undefined) ?? null;
}

/**
 * Right to erasure: delete everything stored about one employee code and block it
 * from being imported again. Returns what was removed.
 */
export async function eraseCandidate(opts: { sourceConnectionId: string; sourceEmployeeCode: string; reason?: string; userId?: string }) {
  const code = opts.sourceEmployeeCode.trim().toUpperCase();
  return prisma.$transaction(async (tx) => {
    const existing = await tx.candidate.findUnique({
      where: { sourceConnectionId_sourceEmployeeCode: { sourceConnectionId: opts.sourceConnectionId, sourceEmployeeCode: code } },
      select: { id: true },
    });
    let deletedCandidate = false;
    if (existing) {
      await tx.candidate.delete({ where: { id: existing.id } }); // profile cascades; sync records keep the code but lose the link
      deletedCandidate = true;
    }
    const syncRecords = (await tx.syncRecord.deleteMany({ where: { sourceEmployeeCode: code } })).count;
    const syncErrors = (await tx.syncError.deleteMany({ where: { sourceEmployeeCode: code } })).count;
    await tx.suppressedRecord.upsert({
      where: { sourceConnectionId_sourceEmployeeCode: { sourceConnectionId: opts.sourceConnectionId, sourceEmployeeCode: code } },
      update: { reason: opts.reason, createdById: opts.userId },
      create: { sourceConnectionId: opts.sourceConnectionId, sourceEmployeeCode: code, reason: opts.reason, createdById: opts.userId },
    });
    return { code, deletedCandidate, syncRecords, syncErrors };
  });
}

export async function listSuppressed(sourceConnectionId?: string) {
  return prisma.suppressedRecord.findMany({ where: sourceConnectionId ? { sourceConnectionId } : {}, orderBy: { createdAt: "desc" }, take: 200 });
}

export async function unsuppress(sourceConnectionId: string, sourceEmployeeCode: string) {
  await prisma.suppressedRecord.deleteMany({ where: { sourceConnectionId, sourceEmployeeCode: sourceEmployeeCode.toUpperCase() } });
}
