import "../env";
import { STALE_JOB_MS, syncOptionsSchema } from "@di/core";
import { prisma } from "@di/db";
import { enqueueJob } from "../jobs/queue";
import { runSyncJob } from "../jobs/run-sync";
import { candidatesWithRetryableDocuments } from "../pipeline/documents";
import { getSourceConnection } from "./source";

/**
 * Run a sync directly from the terminal (no web app needed).
 *   npm run source:sync -- district BULDHANA          # one district
 *   npm run source:sync -- district BULDHANA max 50   # trial cap
 *   npm run source:sync -- all                        # everything
 *   npm run source:sync -- resume <jobId>             # continue an interrupted job
 *   npm run source:sync -- codes E8790 E3559           # re-read specific employees (every section)
 *   npm run source:sync -- retry-documents             # re-read employees whose document downloads are due for a retry
 * Add "list-only" to skip profile pages, or "refresh-profiles" to re-read profiles (and documents) even if read recently.
 */
const args = process.argv.slice(2);
const after = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};

const conn = await getSourceConnection();
let jobId = after("resume");

if (jobId) {
  // Never run a second copy of a job that is still alive (another terminal, the worker daemon):
  // two runners would double the load on the source and overwrite each other's checkpoint.
  const live = await prisma.syncJob.findUnique({ where: { id: jobId }, select: { status: true, heartbeatAt: true, processed: true, totalRecords: true } });
  if (!live) {
    console.error(`No sync job ${jobId}.`);
    process.exit(2);
  }
  const fresh = live.heartbeatAt && Date.now() - live.heartbeatAt.getTime() < STALE_JOB_MS;
  if (live.status === "RUNNING" && fresh) {
    console.error(
      `Job ${jobId} is still running (${live.processed}/${live.totalRecords}, last heartbeat ${Math.round((Date.now() - live.heartbeatAt!.getTime()) / 1000)} s ago). Nothing to resume.\n` +
        `Watch it on the Data Synchronization page. Resume only after it stops (paused, failed, or no heartbeat for ${STALE_JOB_MS / 60_000} minutes).`,
    );
    process.exit(1);
  }
}

if (!jobId && (args.includes("retry-documents") || args.includes("codes"))) {
  // Re-read specific employees (all their sections + documents), or every employee with a
  // document download that failed transiently and is due for another try.
  const codes = args.includes("retry-documents")
    ? await candidatesWithRetryableDocuments(conn.id)
    : args.slice(args.indexOf("codes") + 1).filter((a) => /^E\d{1,10}$/i.test(a)).map((a) => a.toUpperCase());
  if (!codes.length) {
    console.log(args.includes("retry-documents") ? "No document downloads are due for a retry." : "Give employee codes after \"codes\", e.g. codes E8790 E3559");
    process.exit(0);
  }
  const options = syncOptionsSchema.parse({ kind: "retry", codes, includeProfiles: true, profileMaxAgeDays: 0 });
  jobId = (await enqueueJob(conn.id, options, { claimNow: true })).id;
  console.log(`Re-reading ${codes.length} employee(s)…`);
}

if (!jobId) {
  const districtName = after("district")?.toUpperCase();
  const all = args.includes("all");
  if (!districtName && !all) {
    console.error('Say "all", "district <NAME>", or "resume <jobId>".');
    process.exit(2);
  }
  const options = syncOptionsSchema.parse({
    kind: districtName ? "filtered" : "full",
    includeProfiles: !args.includes("list-only"),
    profileMaxAgeDays: args.includes("refresh-profiles") ? 0 : undefined,
    maxRecords: Number(after("max") ?? 0),
  });
  if (districtName) {
    const known = (conn.sourceFilters as { district?: { value: string; label: string }[] } | null)?.district ?? [];
    const match = known.find((d) => d.label.toUpperCase() === districtName);
    if (!match) {
      console.error(
        known.length
          ? `Unknown district "${districtName}". Known: ${known.map((d) => d.label).join(", ")}`
          : "District list not discovered yet — run one sync first (e.g. `all max 1`) to load it.",
      );
      process.exit(2);
    }
    options.filters.district = match;
  }
  // Created already claimed, so a running worker daemon won't also pick it up.
  try {
    jobId = (await enqueueJob(conn.id, options, { claimNow: true })).id;
  } catch (e) {
    const blocking = await prisma.syncJob.findFirst({ where: { sourceConnectionId: conn.id, status: { in: ["QUEUED", "RUNNING"] } }, orderBy: { createdAt: "desc" } });
    console.error(e instanceof Error ? e.message : e);
    if (blocking) console.error(`Blocking job: ${blocking.id} (${blocking.status}). Resume it with "resume ${blocking.id}" or cancel it from the Sync page.`);
    process.exit(1);
  }
}

const status = await runSyncJob(jobId, (m) => console.log(`[${new Date().toLocaleTimeString("en-IN")}] ${m}`));
const job = await prisma.syncJob.findUniqueOrThrow({ where: { id: jobId }, include: { errors: { where: { resolvedAt: null }, take: 10 } } });
console.log(`\n${status}: processed ${job.processed}/${job.totalRecords} · created ${job.created} · updated ${job.updated} · unchanged ${job.unchanged} · failed ${job.failed}`);
for (const e of job.errors) console.log(`  ${e.stage} ${e.sourceEmployeeCode ?? ""} ${e.message}`);
if (status !== "SUCCEEDED") console.log(`\nResume with: npm run source:sync -- resume ${jobId}`);
await prisma.$disconnect();
