import { prisma, type SyncStatus } from "@di/db";

/**
 * Failure notifications for sync jobs. Channels:
 *  - ALERT_WEBHOOK_URL: JSON POST (works with Slack / Teams / Google Chat incoming webhooks or any HTTP endpoint)
 *  - always: an audit-log row (action SYNC_ALERT) that the dashboard shows under Recent activity
 * Messages contain job ids, counts and stage names — never record values.
 */
const BAD: SyncStatus[] = ["FAILED", "PARTIAL", "AWAITING_MFA"];

export async function notifyJobOutcome(jobId: string, status: SyncStatus, log: (m: string) => void = console.log) {
  if (!BAD.includes(status)) return;
  const job = await prisma.syncJob.findUnique({
    where: { id: jobId },
    include: { sourceConnection: { select: { name: true } }, errors: { where: { resolvedAt: null }, take: 3, orderBy: { createdAt: "desc" } } },
  });
  if (!job) return;

  const title = {
    FAILED: `Sync failed`,
    PARTIAL: `Sync finished with ${job.failed} failed record(s)`,
    AWAITING_MFA: `Sync paused — sign in to the source again`,
  }[status as "FAILED" | "PARTIAL" | "AWAITING_MFA"];
  const detail = job.errors.map((e) => `${e.stage}: ${e.message}`).join(" | ") || "—";
  const text = `${title} · ${job.sourceConnection.name} · job ${job.id} · ${job.processed}/${job.totalRecords} processed · ${detail}`;

  await prisma.auditLog.create({ data: { action: "SYNC_ALERT", target: jobId, metadata: { status, failed: job.failed, processed: job.processed, mode: job.mode } } }).catch(() => {});

  const url = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!url) {
    log(`ALERT (no webhook configured): ${text}`);
    return;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, status, jobId, source: job.sourceConnection.name, processed: job.processed, total: job.totalRecords, failed: job.failed }),
      signal: AbortSignal.timeout(10_000),
    });
    log(`alert sent to webhook (${res.status})`);
  } catch (err) {
    log(`alert webhook failed: ${err instanceof Error ? err.message : err}`);
  }
}
