/**
 * District messaging & notifications (Phase 9.6): recipients are limited to the sender's districts,
 * threads are visible only to participants / in-scope admins, and notifications are per user
 * (MySQL, synthetic data, cleaned up).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CurrentUser } from "@/server/auth/session";
import type { Permission } from "@di/db/permissions";

const hasDb = !!process.env.DATABASE_URL;
const TAG = `ZZMSG${Date.now()}`;

describe.skipIf(!hasDb)("district messaging", async () => {
  const { prisma } = await import("@di/db");
  const { DEFAULT_ROLE_PERMISSIONS } = await import("@di/db/permissions");
  const { sendMessage, replyMessage, listThreads, getThread, composeOptions, MessageError } = await import("@/server/services/message.service");
  const { listNotifications, markNotificationsRead } = await import("@/server/services/notification.service");
  const { decideCandidate, confirmReview } = await import("@/server/services/review.service");

  let dA = "", dB = "", daId = "", dvA1 = "", dvA2 = "", dvB = "", sourceId = "", candA = "";

  const mkUser = (id: string, role: keyof typeof DEFAULT_ROLE_PERMISSIONS, districts: string[], extra: Permission[] = []): CurrentUser => ({
    id, email: `${id}@example.test`, name: `${TAG} ${role} ${id.slice(-4)}`, role,
    permissions: [...DEFAULT_ROLE_PERMISSIONS[role], ...extra], districtScopeIds: districts,
  });
  const da = () => mkUser(daId, "DISTRICT_ADMIN", [dA], ["reviews:confirm"]);
  const viewerA1 = () => mkUser(dvA1, "DISTRICT_VIEWER", [dA]);
  const viewerA2 = () => mkUser(dvA2, "DISTRICT_VIEWER", [dA]);
  const viewerB = () => mkUser(dvB, "DISTRICT_VIEWER", [dB]);
  const superAdmin = () => mkUser(daId, "SUPER_ADMIN", []);

  beforeAll(async () => {
    const role = async (name: string) => (await prisma.role.findUniqueOrThrow({ where: { name } })).id;
    dA = (await prisma.district.create({ data: { name: `${TAG} ALPHA` } })).id;
    dB = (await prisma.district.create({ data: { name: `${TAG} BETA` } })).id;
    const user = async (suffix: string, roleName: string, districtId: string) =>
      (await prisma.user.create({ data: { email: `${TAG.toLowerCase()}-${suffix}@example.test`, name: `${TAG} ${suffix}`, passwordHash: "x", roleId: await role(roleName), districtAssignments: { create: { districtId } } } })).id;
    daId = await user("da", "DISTRICT_ADMIN", dA);
    dvA1 = await user("dva1", "DISTRICT_VIEWER", dA);
    dvA2 = await user("dva2", "DISTRICT_VIEWER", dA);
    dvB = await user("dvb", "DISTRICT_VIEWER", dB);
    sourceId = (await prisma.sourceConnection.create({ data: { name: TAG, adapterKey: "synthetic", baseUrl: "https://example.test" } })).id;
    candA = (await prisma.candidate.create({ data: { sourceConnectionId: sourceId, sourceEmployeeCode: "M0001", fullName: `${TAG} Person`, districtId: dA, contentHash: "h", lastSyncedAt: new Date() } })).id;
  });

  afterAll(async () => {
    const ids = [daId, dvA1, dvA2, dvB].filter(Boolean);
    await prisma.districtMessage.deleteMany({ where: { districtId: { in: [dA, dB] } } });
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.candidate.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.sourceConnection.deleteMany({ where: { id: sourceId } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.district.deleteMany({ where: { name: { startsWith: TAG } } });
  });

  it("compose options and recipients stay inside the sender's districts", async () => {
    const opts = await composeOptions(da());
    expect(opts.map((d) => d.id)).toEqual([dA]);
    expect(opts[0].users.map((u) => u.id).sort()).toEqual([dvA1, dvA2].sort());

    // Another district is rejected outright.
    await expect(sendMessage({ user: da(), districtId: dB, kind: "MESSAGE", subject: "Hello", body: "Wrong district" })).rejects.toBeInstanceOf(MessageError);

    // A smuggled recipient from district B is dropped; only district A users receive it.
    const m = await sendMessage({ user: da(), districtId: dA, kind: "ANNOUNCEMENT", subject: "Document check", body: "Verify certificates this week.", recipientIds: [dvA1, dvB] });
    expect(m.recipients).toBe(1);
    const rec = await prisma.messageRecipient.findMany({ where: { messageId: m.id }, select: { userId: true } });
    expect(rec.map((r) => r.userId)).toEqual([dvA1]);
  });

  it("District Viewers cannot send, only reply", async () => {
    await expect(sendMessage({ user: viewerA1(), districtId: dA, kind: "MESSAGE", subject: "Hi", body: "Viewer send" })).rejects.toThrow(/not allowed/);
  });

  it("threads are visible only to participants and in-scope admins; replies notify the thread", async () => {
    const m = await sendMessage({ user: da(), districtId: dA, kind: "MESSAGE", subject: "Weekly target", body: "Please finish pending reviews." });
    expect(m.recipients).toBe(2);

    expect((await listThreads(viewerA1())).rows.map((t) => t.id)).toContain(m.id);
    expect((await listThreads(viewerB())).rows.map((t) => t.id)).not.toContain(m.id);
    expect(await getThread(m.id, viewerB())).toBeNull();
    await expect(replyMessage({ user: viewerB(), parentId: m.id, body: "Not my district" })).rejects.toThrow(/not found/i);

    // Reading marks only the reader's own receipt.
    const before = await listThreads(viewerA1());
    expect(before.rows.find((t) => t.id === m.id)?.unreadForMe).toBe(true);
    await getThread(m.id, viewerA1());
    const receipts = await prisma.messageRecipient.findMany({ where: { messageId: m.id }, select: { userId: true, readAt: true } });
    expect(receipts.find((r) => r.userId === dvA1)?.readAt).not.toBeNull();
    expect(receipts.find((r) => r.userId === dvA2)?.readAt).toBeNull();

    await replyMessage({ user: viewerA1(), parentId: m.id, body: "Will do by Friday." });
    const thread = await getThread(m.id, da());
    expect(thread?.replies.map((r) => r.body)).toEqual(["Will do by Friday."]);
    const daNotes = await listNotifications(da());
    expect(daNotes.items.some((n) => n.type === "REPLY" && n.link === `/messages/${m.id}`)).toBe(true);

    // A global admin can supervise every thread.
    expect(await getThread(m.id, superAdmin())).not.toBeNull();
  });

  it("notifications are per user and mark-read never touches other users' rows", async () => {
    const a1 = await listNotifications(viewerA1());
    const a2 = await listNotifications(viewerA2());
    expect(a1.unread).toBeGreaterThan(0);
    expect(a2.unread).toBeGreaterThan(0);
    expect((await listNotifications(viewerB())).items).toHaveLength(0);

    const foreignIds = a2.items.map((n) => n.id);
    expect(await markNotificationsRead(viewerA1(), foreignIds)).toBe(0); // someone else's ids: no effect
    expect((await listNotifications(viewerA2())).unread).toBe(a2.unread);
    await markNotificationsRead(viewerA1());
    expect((await listNotifications(viewerA1())).unread).toBe(0);
  });

  it("review events: only the Super Admin decides; changing an earlier decision notifies its author", async () => {
    // District Viewers and District Admins can no longer decide or confirm.
    await expect(decideCandidate({ candidateId: candA, decision: "SELECTED", remark: "good fit", user: viewerA1() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const legacy = await prisma.candidateReview.create({ data: { candidateId: candA, decision: "SELECTED", remark: "", previousStatus: "PENDING_REVIEW", newStatus: "SELECTED", reviewedById: dvA1, requiresConfirmation: true } });
    await prisma.candidate.update({ where: { id: candA }, data: { reviewStatus: "SELECTED", reviewPendingConfirmation: true } });
    await expect(confirmReview(legacy.id, da())).rejects.toMatchObject({ code: "FORBIDDEN" });

    // A Super Admin decision on top of that earlier (legacy) one notifies the earlier reviewer.
    await decideCandidate({ candidateId: candA, decision: "REJECTED", remark: "Documents incomplete", user: superAdmin() });
    const reviewerNotes = await listNotifications(viewerA1());
    expect(reviewerNotes.items.some((n) => n.type === "REVIEW_OVERRIDDEN" && n.link === `/candidates/${candA}`)).toBe(true);
    expect((await listNotifications(viewerB())).items.some((n) => n.type === "REVIEW_OVERRIDDEN")).toBe(false);
  });
});
