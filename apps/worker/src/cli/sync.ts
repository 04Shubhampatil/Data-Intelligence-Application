import "../env";
import { syncOptionsSchema } from "@di/core";
import { prisma } from "@di/db";
import { enqueueJob } from "../jobs/queue";
import { runSyncJob } from "../jobs/run-sync";
import { getSourceConnection } from "./source";

/**
 * Run a sync directly from the terminal (no web app needed).
 *   npm run source:sync -- district BULDHANA          # one district
 *   npm run source:sync -- district BULDHANA max 50   # trial cap
 *   npm run source:sync -- all                        # everything
 *   npm run source:sync -- resume <jobId>             # continue an interrupted job
 * Add "list-only" to skip profile pages, or "refresh-profiles" to re-read profiles (and documents) even if read recently.
 */
const args = process.argv.slice(2);
const after = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};

const conn = await getSourceConnection();
let jobId = after("resume");

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
