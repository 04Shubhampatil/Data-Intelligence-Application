"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { MessageError, replyMessage, sendMessage } from "@/server/services/message.service";
import { rateLimit } from "@/server/security/rate-limit";

const TOO_FAST: MessageActionState = { error: "Too many messages in a short time. Please wait a few minutes." };

export type MessageActionState = { ok?: boolean; error?: string; message?: string; threadId?: string } | undefined;
const id = z.string().regex(/^[a-z0-9]{1,40}$/i);

function fail(err: unknown): MessageActionState {
  if (err instanceof MessageError) return { error: err.message };
  console.error("[messages]", err instanceof Error ? err.message : err);
  return { error: "Something went wrong. Please try again." };
}

const sendSchema = z.object({
  districtId: id,
  kind: z.enum(["MESSAGE", "ANNOUNCEMENT", "REMINDER"]),
  subject: z.string().max(200),
  body: z.string().max(5000),
});

export async function sendMessageAction(_prev: MessageActionState, formData: FormData): Promise<MessageActionState> {
  const user = await requireUser("messages:send");
  if (!rateLimit(`msg:send:${user.id}`, 20, 60 * 60_000).ok) return TOO_FAST;
  const parsed = sendSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Please check the form." };
  const recipientIds = formData.getAll("recipientIds").map(String).filter((v) => id.safeParse(v).success);
  try {
    const r = await sendMessage({ ...parsed.data, recipientIds, user });
    revalidatePath("/messages");
    revalidatePath("/district");
    revalidatePath("/review");
    return { ok: true, threadId: r.id, message: `Sent to ${r.recipients} recipient${r.recipients === 1 ? "" : "s"}.` };
  } catch (err) {
    return fail(err);
  }
}

const replySchema = z.object({ parentId: id, body: z.string().max(5000) });

export async function replyMessageAction(_prev: MessageActionState, formData: FormData): Promise<MessageActionState> {
  const user = await requireUser("messages:read");
  if (!rateLimit(`msg:reply:${user.id}`, 40, 10 * 60_000).ok) return TOO_FAST;
  const parsed = replySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Please check the reply." };
  try {
    await replyMessage({ ...parsed.data, user });
    revalidatePath(`/messages/${parsed.data.parentId}`);
    revalidatePath("/messages");
    return { ok: true, message: "Reply sent." };
  } catch (err) {
    return fail(err);
  }
}
