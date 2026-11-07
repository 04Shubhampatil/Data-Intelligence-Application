import "server-only";
import { prisma, type MessageKind, type Prisma } from "@di/db";
import type { CurrentUser } from "@/server/auth/session";
import { districtInScope, isScoped } from "@/server/auth/scope";
import { hasPermission } from "@/lib/rbac";
import { audit } from "@/server/security/audit";
import { notifyUsers } from "./notification.service";

export class MessageError extends Error {
  constructor(message: string, public code: "NOT_FOUND" | "FORBIDDEN" | "INVALID" = "INVALID") {
    super(message);
  }
}

const SUBJECT_MAX = 200;
const BODY_MAX = 5000;
const PAGE = 20;

/** Who may receive a message in a district: active users assigned to it (never the sender). */
export async function districtRecipients(districtId: string, excludeUserId?: string) {
  return prisma.user.findMany({
    where: { isActive: true, districtAssignments: { some: { districtId } }, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
    select: { id: true, name: true, username: true, role: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
}

/** Districts the user may send to, with the assigned users of each (compose form data). */
export async function composeOptions(user: CurrentUser) {
  if (!hasPermission(user.permissions, "messages:send")) return [];
  const districts = await prisma.district.findMany({
    where: isScoped(user) ? { id: { in: user.districtScopeIds } } : { assignments: { some: {} } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, assignments: { where: { user: { isActive: true, id: { not: user.id } } }, select: { user: { select: { id: true, name: true, username: true, role: { select: { name: true } } } } } } },
  });
  return districts.map((d) => ({ id: d.id, name: d.name, users: d.assignments.map((a) => ({ id: a.user.id, label: a.user.name ?? a.user.username, role: a.user.role.name })) }));
}

/**
 * Sends a message / announcement / reminder to users of one district.
 * - messages:send required; district must be in the sender's scope;
 * - recipients default to everyone assigned to the district; an explicit list is intersected with that set;
 * - every recipient gets a receipt row (read receipts) and a bell notification.
 */
export async function sendMessage(opts: { user: CurrentUser; districtId: string; kind: MessageKind; subject: string; body: string; recipientIds?: string[] }) {
  const { user } = opts;
  if (!hasPermission(user.permissions, "messages:send")) throw new MessageError("You are not allowed to send messages.", "FORBIDDEN");
  if (!districtInScope(user, opts.districtId)) throw new MessageError("District not found.", "NOT_FOUND");
  const subject = opts.subject.trim();
  const body = opts.body.trim();
  if (subject.length < 2 || subject.length > SUBJECT_MAX) throw new MessageError(`Subject must be 2–${SUBJECT_MAX} characters.`);
  if (body.length < 2 || body.length > BODY_MAX) throw new MessageError(`Message must be 2–${BODY_MAX} characters.`);
  const district = await prisma.district.findUnique({ where: { id: opts.districtId }, select: { id: true, name: true } });
  if (!district) throw new MessageError("District not found.", "NOT_FOUND");

  const allowed = await districtRecipients(district.id, user.id);
  const chosen = opts.recipientIds?.length ? allowed.filter((u) => opts.recipientIds!.includes(u.id)) : allowed;
  if (!chosen.length) throw new MessageError("No recipients: nobody is assigned to this district yet.");

  const message = await prisma.districtMessage.create({
    data: {
      districtId: district.id,
      senderId: user.id,
      kind: opts.kind,
      subject,
      body,
      recipients: { createMany: { data: chosen.map((u) => ({ userId: u.id })) } },
    },
    select: { id: true, createdAt: true },
  });
  const label = opts.kind === "ANNOUNCEMENT" ? "Announcement" : opts.kind === "REMINDER" ? "Reminder" : "New message";
  await notifyUsers(
    chosen.map((u) => u.id),
    { type: opts.kind === "MESSAGE" ? "MESSAGE" : opts.kind, title: `${label}: ${subject}`, body: `${user.name ?? user.username} · ${district.name}`, link: `/messages/${message.id}` },
  );
  await audit("MESSAGE_SEND", { userId: user.id, target: message.id, metadata: { districtId: district.id, kind: opts.kind, recipients: chosen.length } });
  return { ...message, recipients: chosen.length };
}

/** A thread is readable by its sender, its recipients, and global/in-scope users with messages:read. */
function threadAccess(user: CurrentUser): Prisma.DistrictMessageWhereInput {
  const participant: Prisma.DistrictMessageWhereInput = { OR: [{ senderId: user.id }, { recipients: { some: { userId: user.id } } }] };
  if (!isScoped(user)) return {}; // global roles see every thread
  if (user.role === "DISTRICT_ADMIN") return { districtId: { in: user.districtScopeIds } };
  return participant;
}

/** Reply inside a thread (District Viewers need messages:reply; senders/admins messages:send). */
export async function replyMessage(opts: { user: CurrentUser; parentId: string; body: string }) {
  const { user } = opts;
  if (!hasPermission(user.permissions, "messages:read")) throw new MessageError("You are not allowed to read messages.", "FORBIDDEN");
  if (!hasPermission(user.permissions, "messages:reply") && !hasPermission(user.permissions, "messages:send")) throw new MessageError("You are not allowed to reply.", "FORBIDDEN");
  const body = opts.body.trim();
  if (body.length < 2 || body.length > BODY_MAX) throw new MessageError(`Reply must be 2–${BODY_MAX} characters.`);

  const parent = await prisma.districtMessage.findFirst({
    where: { id: opts.parentId, parentId: null, ...threadAccess(user) },
    select: { id: true, districtId: true, senderId: true, subject: true, district: { select: { name: true } }, recipients: { select: { userId: true } } },
  });
  if (!parent) throw new MessageError("Message not found.", "NOT_FOUND");

  // Everyone in the thread except the replier hears about it.
  const audience = [...new Set([parent.senderId, ...parent.recipients.map((r) => r.userId)])].filter((id) => id !== user.id);
  const reply = await prisma.districtMessage.create({
    data: {
      districtId: parent.districtId,
      senderId: user.id,
      kind: "MESSAGE",
      subject: parent.subject.startsWith("Re: ") ? parent.subject : `Re: ${parent.subject}`.slice(0, SUBJECT_MAX),
      body,
      parentId: parent.id,
      recipients: { createMany: { data: audience.map((userId) => ({ userId })) } },
    },
    select: { id: true, createdAt: true },
  });
  await notifyUsers(audience, { type: "REPLY", title: `Reply: ${parent.subject}`, body: `${user.name ?? user.username} · ${parent.district.name}`, link: `/messages/${parent.id}` });
  await audit("MESSAGE_REPLY", { userId: user.id, target: parent.id, metadata: { replyId: reply.id } });
  return reply;
}

export async function listThreads(user: CurrentUser, opts: { districtId?: string; page?: number; take?: number } = {}) {
  if (!hasPermission(user.permissions, "messages:read")) return { rows: [], total: 0, page: 1, pageSize: PAGE, pageCount: 1 };
  const page = Math.max(1, opts.page ?? 1);
  const take = opts.take ?? PAGE;
  const where: Prisma.DistrictMessageWhereInput = {
    parentId: null,
    ...threadAccess(user),
    ...(opts.districtId && districtInScope(user, opts.districtId) ? { districtId: opts.districtId } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.districtMessage.count({ where }),
    prisma.districtMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * take,
      take,
      select: {
        id: true, kind: true, subject: true, body: true, createdAt: true,
        district: { select: { id: true, name: true } },
        sender: { select: { id: true, name: true, username: true } },
        recipients: { select: { userId: true, readAt: true } },
        _count: { select: { replies: true } },
      },
    }),
  ]);
  return {
    total, page, pageSize: take, pageCount: Math.max(1, Math.ceil(total / take)),
    rows: rows.map((m) => ({
      ...m,
      readCount: m.recipients.filter((r) => r.readAt).length,
      recipientCount: m.recipients.length,
      unreadForMe: m.recipients.some((r) => r.userId === user.id && !r.readAt),
    })),
  };
}

/** Full thread with replies and read receipts; marks the viewer's own receipts as read. */
export async function getThread(threadId: string, user: CurrentUser) {
  if (!hasPermission(user.permissions, "messages:read")) return null;
  const allowed = await prisma.districtMessage.findFirst({ where: { id: threadId, parentId: null, ...threadAccess(user) }, select: { id: true } });
  if (!allowed) return null;
  // Read receipts for the thread and its replies, for this user only — before loading, so the page shows them.
  await prisma.messageRecipient.updateMany({
    where: { userId: user.id, readAt: null, OR: [{ messageId: allowed.id }, { message: { parentId: allowed.id } }] },
    data: { readAt: new Date() },
  });
  return prisma.districtMessage.findUnique({
    where: { id: allowed.id },
    select: {
      id: true, kind: true, subject: true, body: true, createdAt: true,
      district: { select: { id: true, name: true } },
      sender: { select: { id: true, name: true, username: true, role: { select: { name: true } } } },
      recipients: { select: { userId: true, deliveredAt: true, readAt: true, user: { select: { name: true, username: true, role: { select: { name: true } } } } }, orderBy: { user: { name: "asc" } } },
      replies: {
        orderBy: { createdAt: "asc" },
        select: { id: true, body: true, createdAt: true, sender: { select: { id: true, name: true, username: true, role: { select: { name: true } } } } },
      },
    },
  });
}

export async function unreadMessageCount(user: Pick<CurrentUser, "id">) {
  return prisma.messageRecipient.count({ where: { userId: user.id, readAt: null } });
}
