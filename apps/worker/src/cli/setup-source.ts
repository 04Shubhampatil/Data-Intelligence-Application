import "../env";
import { FIELD_DEFS } from "@di/core";
import { prisma } from "@di/db";
import { ensureDocumentPolicies, ensureFieldPolicies } from "../pipeline/field-policy";
import { DEFAULT_SOURCE } from "./source";

/** Creates the MahaHRD source connection (manual-session mode, no stored password) and default field policies. */
let conn = await prisma.sourceConnection.findFirst({ where: { adapterKey: DEFAULT_SOURCE.adapterKey } });
if (!conn) {
  conn = await prisma.sourceConnection.create({ data: { ...DEFAULT_SOURCE, authMode: "MANUAL_SESSION", rateLimitMs: 2500 } });
  console.log(`Created source connection "${conn.name}" (${conn.baseUrl}).`);
} else {
  console.log(`Source connection "${conn.name}" already exists.`);
}
await ensureFieldPolicies(conn.id);
await ensureDocumentPolicies(conn.id);

const policies = await prisma.fieldPolicy.findMany({ where: { sourceConnectionId: conn.id }, orderBy: { fieldKey: "asc" } });
console.log("\nField policy (only ✔ fields are ever stored):");
for (const p of policies) {
  const label = FIELD_DEFS[p.fieldKey as keyof typeof FIELD_DEFS]?.label ?? p.fieldKey;
  console.log(`  ${p.allowed ? "✔" : "✘"} ${label}`);
}
await prisma.$disconnect();
