"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@di/db";
import { eraseCandidate, retentionSettingsSchema, runRetentionCleanup, saveRetentionSettings, unsuppress } from "@di/db/retention";
import { requireUser } from "@/server/auth/session";
import { audit } from "@/server/security/audit";

export type RetentionState = { ok?: boolean; error?: string; message?: string } | undefined;

export async function saveRetentionAction(_prev: RetentionState, formData: FormData): Promise<RetentionState> {
  const user = await requireUser("settings:write");
  const parsed = retentionSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Please enter whole numbers of days (0 = keep forever)." };
  await saveRetentionSettings(parsed.data);
  await audit("SETTINGS_UPDATE", { userId: user.id, target: "retention", metadata: parsed.data });
  revalidatePath("/settings");
  return { ok: true, message: "Retention settings saved. The worker applies them daily; you can also run cleanup now." };
}

export async function runCleanupAction(): Promise<RetentionState> {
  const user = await requireUser("settings:write");
  const r = await runRetentionCleanup();
  await audit("DATA_PURGE", { userId: user.id, metadata: r });
  revalidatePath("/settings");
  return { ok: true, message: `Cleanup done: ${r.syncJobs} sync jobs, ${r.auditLogs} audit rows, ${r.assistantResults} assistant results, ${r.reportRuns} report runs, ${r.purgedCandidates} purged candidates.` };
}

const eraseSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{1,4}\d{1,10}$/, "Enter an employee code like E1234"),
  reason: z.string().trim().max(200).optional(),
  confirm: z.literal("on", { error: "Tick the confirmation box" }),
});

export async function eraseCandidateAction(_prev: RetentionState, formData: FormData): Promise<RetentionState> {
  const user = await requireUser("settings:write");
  const parsed = eraseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const source = await prisma.sourceConnection.findFirst({ where: { isActive: true, adapterKey: { not: "synthetic" } }, select: { id: true } });
  if (!source) return { error: "No source connection." };

  const r = await eraseCandidate({ sourceConnectionId: source.id, sourceEmployeeCode: parsed.data.code, reason: parsed.data.reason, userId: user.id });
  // The code itself is the only identifier kept (needed to block re-import); no name or other data.
  await audit("ERASURE", { userId: user.id, target: r.code, metadata: { deletedCandidate: r.deletedCandidate, syncRecords: r.syncRecords, syncErrors: r.syncErrors } });
  revalidatePath("/settings");
  revalidatePath("/candidates");
  return {
    ok: true,
    message: r.deletedCandidate
      ? `${r.code} erased (record, contact data, ${r.syncRecords} sync log rows) and blocked from future syncs.`
      : `${r.code} was not in the database; it is now blocked from future syncs.`,
  };
}

export async function unsuppressAction(code: string) {
  const user = await requireUser("settings:write");
  const c = z.string().regex(/^[A-Z]{1,4}\d{1,10}$/).parse(code.toUpperCase());
  const source = await prisma.sourceConnection.findFirst({ where: { isActive: true, adapterKey: { not: "synthetic" } }, select: { id: true } });
  if (!source) return;
  await unsuppress(source.id, c);
  await audit("SETTINGS_UPDATE", { userId: user.id, target: c, metadata: { action: "unblock" } });
  revalidatePath("/settings");
}
