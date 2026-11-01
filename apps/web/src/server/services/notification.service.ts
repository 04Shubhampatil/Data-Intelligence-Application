import "server-only";
import { prisma } from "@di/db";
import type { CurrentUser } from "@/server/auth/session";

export type NotificationType = "MESSAGE" | "REPLY" | "REVIEW_AWAITING" | "REVIEW_CONFIRMED" | "REVIEW_OVERRIDDEN" | "REMINDER" | "ANNOUNCEMENT";

/** Fan-out helper. Never throws — a failed notification must not break the action that triggered it. */
export async function notifyUsers(userIds: readonly string[], n: { type: NotificationType; title: string; body?: string | null; link?: string | null }) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return 0;
  try {
    const r = await prisma.notification.createMany({
      data: ids.map((userId) => ({ userId, type: n.type, title: n.title.slice(0, 200), body: n.body?.slice(0, 2000) ?? null, link: n.link?.slice(0, 300) ?? null })),
    });
    return r.count;
  } catch (err) {
    console.error("[notify] failed", err instanceof Error ? err.message : err);
    return 0;
  }
}

/** Active District Admins assigned to a district (plus nobody else — global admins use the dashboards). */
export async function districtAdminIds(districtId: string | null | undefined) {
  if (!districtId) return [];
  const rows = await prisma.user.findMany({
    where: { isActive: true, role: { name: "DISTRICT_ADMIN" }, districtAssignments: { some: { districtId } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function listNotifications(user: Pick<CurrentUser, "id">, take = 20) {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take, select: { id: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true } }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return { items, unread };
}

export async function unreadNotificationCount(user: Pick<CurrentUser, "id">) {
  return prisma.notification.count({ where: { userId: user.id, readAt: null } });
}

/** Marks the user's own notifications read (all, or a subset by id). Rows of other users are never touched. */
export async function markNotificationsRead(user: Pick<CurrentUser, "id">, ids?: string[]) {
  const r = await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return r.count;
}
