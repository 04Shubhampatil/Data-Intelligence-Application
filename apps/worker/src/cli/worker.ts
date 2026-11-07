import "../env";
import { prisma } from "@di/db";
import { claimNextJob } from "../jobs/queue";
import { runSyncJobWithAutoLogin } from "../jobs/run-with-login";
import { autoLogin } from "../browser/auto-login";
import { runDueSchedules, recordScheduleOutcome } from "../jobs/scheduler";
import { writeWorkerHeartbeat } from "../jobs/heartbeat";
import { notifyJobOutcome } from "../notify";
import { runRetentionCleanup } from "@di/db/retention";

/**
 * Long-running worker:
 *  - queues jobs for due schedules (hourly / daily / weekly),
 *  - picks up queued jobs (from the web app or schedules) one at a time,
 *  - writes a heartbeat so the web app can show it is alive,
 *  - runs "Test connection" requests from Settings (automatic sign-in with the saved credentials),
 *  - notifies on failures.
 * Ctrl-C stops after the current record; the job resumes from its checkpoint.
 */
const POLL_MS = 5000;
const startedAt = new Date();
let stopping = false;
let currentJob: string | null = null;

const stamp = () => new Date().toLocaleTimeString("en-IN");
const log = (m: string) => console.log(`[${stamp()}] ${m}`);

process.on("SIGINT", async () => {
  if (stopping) process.exit(1);
  stopping = true;
  log("Stopping… (press Ctrl-C again to force)");
  if (currentJob) await prisma.syncJob.update({ where: { id: currentJob }, data: { cancelRequested: true } }).catch(() => {});
});
process.on("SIGTERM", () => process.emit("SIGINT"));

// Heartbeat runs independently of job progress.
const heartbeat = setInterval(() => void writeWorkerHeartbeat({ currentJobId: currentJob, startedAt }), 15_000);
await writeWorkerHeartbeat({ currentJobId: null, startedAt });

let lastCleanup = 0;
log("Sync worker started. Waiting for jobs and schedules…");
while (!stopping) {
  if (Date.now() - lastCleanup > 24 * 3_600_000) {
    lastCleanup = Date.now();
    try {
      const r = await runRetentionCleanup();
      log(`retention cleanup: ${r.syncJobs} sync jobs, ${r.auditLogs} audit rows, ${r.assistantResults} assistant results, ${r.reportRuns} report runs, ${r.purgedCandidates} purged candidates`);
    } catch (e) {
      log(`retention cleanup failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  // "Test connection" from Settings → Source connection: sign in once and record the outcome.
  try {
    const tests = await prisma.sourceConnection.findMany({ where: { loginTestRequestedAt: { not: null } }, select: { id: true, name: true } });
    for (const t of tests) {
      log(`connection test requested for ${t.name}`);
      await prisma.sourceConnection.update({ where: { id: t.id }, data: { loginTestRequestedAt: null } });
      const r = await autoLogin(t.id, log);
      log(r.ok ? `connection test for ${t.name}: signed in` : `connection test for ${t.name} failed: ${r.reason}`);
    }
  } catch (e) {
    log(`connection test error: ${e instanceof Error ? e.message : e}`);
  }

  try {
    await runDueSchedules(new Date(), log);
  } catch (e) {
    log(`scheduler error: ${e instanceof Error ? e.message : e}`);
  }

  const id = await claimNextJob().catch((e) => {
    log(`queue error: ${e instanceof Error ? e.message : e}`);
    return null;
  });
  if (!id) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    continue;
  }

  currentJob = id;
  await writeWorkerHeartbeat({ currentJobId: id, startedAt });
  log(`Running job ${id}`);
  try {
    const status = await runSyncJobWithAutoLogin(id, log);
    await recordScheduleOutcome(id);
    await notifyJobOutcome(id, status, log);
  } catch (e) {
    log(`job ${id} crashed: ${e instanceof Error ? e.message : e}`);
    await prisma.syncJob.update({ where: { id }, data: { status: "FAILED", finishedAt: new Date() } }).catch(() => {});
    await recordScheduleOutcome(id);
    await notifyJobOutcome(id, "FAILED", log);
  }
  currentJob = null;
}
clearInterval(heartbeat);
await prisma.$disconnect();
log("Worker stopped.");
