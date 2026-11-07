import "../env";
import { DOCUMENT_DEFS, SENSITIVE_GROUPS, syncOptionsSchema, type DocumentKind, type SensitiveGroup } from "@di/core";
import { prisma } from "@di/db";
import { enqueueJob } from "../jobs/queue";
import { runSyncJobWithAutoLogin } from "../jobs/run-with-login";
import { getSourceConnection } from "./source";

/**
 * Extract ONE employee end-to-end through the normal sync pipeline (profile, every approved
 * section, attendance, tickets, documents) and print a summary of what was stored.
 * The summary shows section names and counts only — never personal values.
 *
 *   npm run source:extract-one -- E1234
 */
const code = process.argv.slice(2).find((a) => /^E\d+$/i.test(a))?.toUpperCase();
if (!code) {
  console.error("Give an employee code, e.g. npm run source:extract-one -- E8790");
  process.exit(2);
}

const conn = await getSourceConnection();
const options = syncOptionsSchema.parse({ kind: "one", codes: [code], includeProfiles: true, profileMaxAgeDays: 0 });
let jobId: string;
try {
  jobId = (await enqueueJob(conn.id, options, { claimNow: true })).id;
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}

const status = await runSyncJobWithAutoLogin(jobId, (m) => console.log(`[${new Date().toLocaleTimeString("en-IN")}] ${m}`));
const job = await prisma.syncJob.findUniqueOrThrow({ where: { id: jobId }, include: { errors: { where: { resolvedAt: null }, take: 20 } } });
console.log(`\n${status === "SUCCEEDED" ? "✔" : "✘"} Sync job ${jobId} — ${status} (created ${job.created}, updated ${job.updated}, unchanged ${job.unchanged}, failed ${job.failed})`);
for (const e of job.errors) console.log(`  ! ${e.stage}: ${e.message}`);

const c = await prisma.candidate.findUnique({
  where: { sourceConnectionId_sourceEmployeeCode: { sourceConnectionId: conn.id, sourceEmployeeCode: code } },
  select: {
    fullName: true, profileSyncedAt: true, documentsSyncedAt: true, attendanceSyncedAt: true, ticketsSyncedAt: true,
    profile: { select: { personalEncrypted: true, officeLat: true } },
    sensitive: { select: { group: true, syncedAt: true } },
    documents: { select: { kind: true, slot: true, status: true, mimeType: true, sizeBytes: true, encrypted: true, sourceVerification: true, error: true }, orderBy: [{ kind: "asc" }, { slot: "asc" }] },
    attendance: { select: { year: true, month: true, present: true, absent: true, days: true }, orderBy: [{ year: "desc" }, { month: "desc" }], take: 1 },
    _count: { select: { tickets: true } },
  },
});
if (c) {
  const yes = (b: unknown) => (b ? "yes" : "no");
  console.log(`\n  Profile read:            ${yes(c.profileSyncedAt)}`);
  console.log(`  Profile & employment:    ${yes(c.profile?.personalEncrypted)} (encrypted)`);
  console.log(`  Office location:         ${yes(c.profile?.officeLat != null)}`);
  for (const g of Object.keys(SENSITIVE_GROUPS) as SensitiveGroup[]) {
    console.log(`  ${(SENSITIVE_GROUPS[g].label + ":").padEnd(24)} ${yes(c.sensitive.some((s) => s.group === g))}${c.sensitive.some((s) => s.group === g) ? " (encrypted)" : ""}`);
  }
  const a = c.attendance[0];
  console.log(`  Attendance:              ${a ? `${a.year}-${String(a.month).padStart(2, "0")} — ${(a.days as unknown[]).length} day rows` : "none"}`);
  console.log(`  Tickets:                 ${c._count.tickets}`);
  console.log(`  Documents (${c.documents.length}):`);
  for (const d of c.documents) {
    const label = `${DOCUMENT_DEFS[d.kind as DocumentKind]?.label ?? d.kind}${d.slot ? ` #${d.slot + 1}` : ""}`;
    const size = d.sizeBytes ? `${Math.round(d.sizeBytes / 1024)} KB` : "";
    console.log(`    ${label.padEnd(24)} ${d.status.padEnd(18)} ${(d.mimeType ?? "").padEnd(16)} ${size.padEnd(8)} ${d.encrypted ? "encrypted" : "         "} ${d.sourceVerification ?? ""}${d.error ? `  (${d.error})` : ""}`);
  }
}
await prisma.$disconnect();
