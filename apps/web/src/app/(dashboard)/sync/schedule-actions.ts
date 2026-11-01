"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { computeNextRun, DEFAULT_TIME_ZONE, scheduleSpecSchema, syncOptionsSchema } from "@di/core";
import { prisma } from "@di/db";
import { requireUser } from "@/server/auth/session";
import { audit } from "@/server/security/audit";
import { getSources } from "@/server/services/sync.service";
import type { ActionState } from "./actions";

const TZ = process.env.TZ || DEFAULT_TIME_ZONE;
const id = z.string().regex(/^[a-z0-9]{1,40}$/i);

const createSchema = scheduleSpecSchema.extend({
  sourceId: id,
  name: z.string().trim().min(2).max(60),
  scope: z.enum(["all", "district"]),
  district: z.string().regex(/^\d{1,10}$/).optional().or(z.literal("")),
  includeProfiles: z.enum(["on"]).optional(),
});

export async function createScheduleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser("sync:run");
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Please check the schedule details." };
  const input = parsed.data;

  const source = (await getSources()).find((s) => s.id === input.sourceId);
  if (!source) return { error: "Unknown source." };

  const options = syncOptionsSchema.parse({ kind: input.scope === "all" ? "full" : "filtered", includeProfiles: input.includeProfiles === "on" });
  if (input.scope === "district") {
    const d = source.districts.find((x) => x.value === input.district);
    if (!d) return { error: "Choose a district." };
    options.filters.district = d;
  }
  const spec = { frequency: input.frequency, minute: input.minute, hour: input.hour, weekday: input.weekday };
  const schedule = await prisma.syncSchedule.create({
    data: { ...spec, sourceConnectionId: source.id, name: input.name, options, nextRunAt: computeNextRun(spec, new Date(), TZ), createdById: user.id },
  });
  await audit("SCHEDULE_UPDATE", { userId: user.id, target: schedule.id, metadata: { action: "create", frequency: spec.frequency } });
  revalidatePath("/sync");
  return { ok: true, message: "Schedule created." };
}

export async function toggleScheduleAction(scheduleId: string, enabled: boolean) {
  const user = await requireUser("sync:run");
  const sid = id.parse(scheduleId);
  const s = await prisma.syncSchedule.findUniqueOrThrow({ where: { id: sid } });
  const spec = { frequency: s.frequency, minute: s.minute, hour: s.hour, weekday: s.weekday };
  await prisma.syncSchedule.update({ where: { id: sid }, data: { enabled, nextRunAt: enabled ? computeNextRun(spec, new Date(), TZ) : null } });
  await audit("SCHEDULE_UPDATE", { userId: user.id, target: sid, metadata: { action: enabled ? "enable" : "disable" } });
  revalidatePath("/sync");
}

export async function deleteScheduleAction(scheduleId: string) {
  const user = await requireUser("sync:run");
  const sid = id.parse(scheduleId);
  await prisma.syncSchedule.delete({ where: { id: sid } });
  await audit("SCHEDULE_UPDATE", { userId: user.id, target: sid, metadata: { action: "delete" } });
  revalidatePath("/sync");
}

/** Makes the schedule due now; the worker queues it on its next poll (within ~5 s). */
export async function runScheduleNowAction(scheduleId: string) {
  const user = await requireUser("sync:run");
  const sid = id.parse(scheduleId);
  await prisma.syncSchedule.update({ where: { id: sid }, data: { enabled: true, nextRunAt: new Date() } });
  await audit("SCHEDULE_UPDATE", { userId: user.id, target: sid, metadata: { action: "run_now" } });
  revalidatePath("/sync");
}
