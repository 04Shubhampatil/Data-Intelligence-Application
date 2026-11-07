"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { syncOptionsSchema } from "@di/core";
import { prisma } from "@di/db";
import { enqueueJob, hasActiveJob } from "@di/db/sync-queue";
import { requireUser } from "@/server/auth/session";
import { audit } from "@/server/security/audit";
import { getSources, isResumable } from "@/server/services/sync.service";
import { sourceCommands } from "@/lib/source-commands";

export type ActionState = { ok?: boolean; error?: string; message?: string } | undefined;

const startSchema = z.object({
  sourceId: z.string().regex(/^[a-z0-9]{1,40}$/i),
  scope: z.enum(["all", "district"]),
  district: z.string().regex(/^\d{1,10}$/).optional().or(z.literal("")),
  includeProfiles: z.enum(["on"]).optional(),
  maxRecords: z.coerce.number().int().min(0).max(100_000).catch(0),
});

export async function startSyncAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser("sync:run");
  const parsed = startSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Please check the sync options." };
  const input = parsed.data;

  const source = (await getSources()).find((s) => s.id === input.sourceId);
  if (!source) return { error: "Unknown source." };
  if (!source.sessionSavedAt && !(source.authMode === "CREDENTIALS" && source.hasPassword)) return { error: `Not signed in to ${source.name}. Run \`${sourceCommands(source.adapterKey).login}\` first.` };

  const options = syncOptionsSchema.parse({
    kind: input.scope === "all" ? "full" : "filtered",
    includeProfiles: input.includeProfiles === "on",
    maxRecords: input.maxRecords,
  });
  if (input.scope === "district") {
    const d = source.districts.find((x) => x.value === input.district);
    if (!d) return { error: "Choose a district." };
    options.filters.district = d;
  }

  try {
    const job = await enqueueJob(source.id, options, { triggeredById: user.id });
    await audit("SYNC_START", { userId: user.id, target: job.id, metadata: { kind: options.kind, district: options.filters.district?.label ?? null } });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not queue the sync." };
  }
  revalidatePath("/sync");
  return { ok: true, message: "Sync queued. The worker will pick it up within a few seconds." };
}

const idSchema = z.string().regex(/^[a-z0-9]{1,40}$/i);

export async function cancelSyncAction(jobId: string) {
  const user = await requireUser("sync:run");
  const id = idSchema.parse(jobId);
  const job = await prisma.syncJob.findUnique({ where: { id }, select: { status: true } });
  if (!job) return;
  if (job.status === "QUEUED") {
    await prisma.syncJob.update({ where: { id }, data: { status: "CANCELLED", finishedAt: new Date() } });
  } else if (job.status === "RUNNING") {
    await prisma.syncJob.update({ where: { id }, data: { cancelRequested: true } }); // worker stops after the current record
  }
  await audit("SYNC_CANCEL", { userId: user.id, target: id });
  revalidatePath("/sync");
  revalidatePath(`/sync/${id}`);
}

export async function resumeSyncAction(jobId: string) {
  const user = await requireUser("sync:run");
  const id = idSchema.parse(jobId);
  const job = await prisma.syncJob.findUniqueOrThrow({ where: { id } });
  if (!isResumable(job)) return;
  if (await hasActiveJob(job.sourceConnectionId)) return;
  await prisma.syncJob.update({ where: { id }, data: { status: "QUEUED", cancelRequested: false, finishedAt: null, heartbeatAt: null } });
  await audit("SYNC_START", { userId: user.id, target: id, metadata: { action: "resume" } });
  revalidatePath("/sync");
  revalidatePath(`/sync/${id}`);
}

export async function retryFailedAction(jobId: string) {
  const user = await requireUser("sync:run");
  const id = idSchema.parse(jobId);
  const job = await prisma.syncJob.findUniqueOrThrow({ where: { id } });
  const errors = await prisma.syncError.findMany({
    where: { syncJobId: id, resolvedAt: null, sourceEmployeeCode: { not: null } },
    select: { sourceEmployeeCode: true },
    distinct: ["sourceEmployeeCode"],
    take: 5000,
  });
  const codes = errors.map((e) => e.sourceEmployeeCode!).filter((c) => /^[A-Z]{1,4}\d{1,10}$/.test(c));
  if (!codes.length) return;
  const options = syncOptionsSchema.parse({ kind: "retry", codes, includeProfiles: true, profileMaxAgeDays: 0 });
  const retry = await enqueueJob(job.sourceConnectionId, options, { triggeredById: user.id, retryOfJobId: id }).catch(() => null);
  if (retry) await audit("SYNC_START", { userId: user.id, target: retry.id, metadata: { action: "retry", of: id, count: codes.length } });
  revalidatePath("/sync");
  revalidatePath(`/sync/${id}`);
}
