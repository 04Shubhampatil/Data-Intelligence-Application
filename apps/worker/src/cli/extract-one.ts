import "../env";
import { FIELD_DEFS, type FieldKey } from "@di/core";
import { prisma } from "@di/db";
import { extractOne } from "../jobs/extract-one";
import { getSourceConnection } from "./source";

/**
 * Usage:
 *   npm run source:extract-one -- E1234             # a specific employee code
 *   npm run source:extract-one -- first             # first row of the records list
 * Add --headed to watch the (read-only) browser.
 */
const args = process.argv.slice(2);
const code = args.find((a) => /^E\d+$/i.test(a))?.toUpperCase();
const headed = args.includes("--headed");
const first = args.includes("--first") || args.includes("first");
if (!code && !first) {
  console.error("Give an employee code (e.g. E1234) or --first.");
  process.exit(2);
}

const conn = await getSourceConnection();
const result = await extractOne({ connectionId: conn.id, code, headed });

if (result.ok) {
  console.log(`\n✔ Sync job ${result.jobId} — ${result.outcome}`);
  console.log(`  Source reports ${result.sourceTotal.toLocaleString("en-IN")} records (only 1 was read).\n`);
  console.log("  Stored fields (allow-listed only):");
  for (const [k, v] of Object.entries(result.stored)) {
    const label = FIELD_DEFS[k as FieldKey]?.label ?? k;
    const shown = v instanceof Date ? v.toISOString().slice(0, 10) : (v ?? "—");
    console.log(`    ${label.padEnd(36)} ${shown}`);
  }
} else {
  console.error(`\n✘ Sync job ${result.jobId} failed at ${result.stage}: ${result.message}`);
  process.exitCode = 1;
}
if (result.guard) {
  console.log(`\n  Guard: ${result.guard.allowed} requests allowed, ${result.guard.blocked.length} blocked.`);
  for (const b of result.guard.blocked.slice(0, 15)) console.log(`    blocked ${b.method} ${b.path} (${b.reason})`);
}
await prisma.$disconnect();
