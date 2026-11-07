/**
 * District dashboards (Phase 5): the District Admin table/counts/activity and the
 * District Viewer queue must stay inside the user's districts (MySQL, synthetic data, cleaned up).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CurrentUser } from "@/server/auth/session";

const hasDb = !!process.env.DATABASE_URL;
const TAG = `ZZDD${Date.now()}`;

describe.skipIf(!hasDb)("district dashboards", async () => {
  const { prisma } = await import("@di/db");
  const { getDistrictCounts, getReviewTable, getRecentReviewActivity, getReviewerOptions, getViewerQueue, getDistrictViewers, getVerifiedRecords, parseReviewFilters } = await import(
    "@/server/services/district.service"
  );

  let sourceId = "", dA = "", dB = "", candA = "", candB = "", viewerId = "", adminId = "";

  const admin = (): CurrentUser => ({ id: adminId, username: `${TAG}-da@example.test`, name: "DA", role: "DISTRICT_ADMIN", permissions: ["reviews:read", "candidates:read"], districtScopeIds: [dA] });
  const viewer = (): CurrentUser => ({ id: viewerId, username: `${TAG}-dv@example.test`, name: "DV", role: "DISTRICT_VIEWER", permissions: ["reviews:read", "reviews:decide"], districtScopeIds: [dA] });
  const global = (): CurrentUser => ({ ...admin(), role: "SUPER_ADMIN", districtScopeIds: [] });

  beforeAll(async () => {
    const dvRole = await prisma.role.findUniqueOrThrow({ where: { name: "DISTRICT_VIEWER" } });
    const daRole = await prisma.role.findUniqueOrThrow({ where: { name: "DISTRICT_ADMIN" } });
    dA = (await prisma.district.create({ data: { name: `${TAG} ALPHA` } })).id;
    dB = (await prisma.district.create({ data: { name: `${TAG} BETA` } })).id;
    adminId = (await prisma.user.create({ data: { username: `${TAG}-da@example.test`, passwordHash: "x", roleId: daRole.id, districtAssignments: { create: { districtId: dA } } } })).id;
    viewerId = (await prisma.user.create({ data: { username: `${TAG}-dv@example.test`, name: `${TAG} Viewer`, passwordHash: "x", roleId: dvRole.id, districtAssignments: { create: { districtId: dA } } } })).id;
    sourceId = (await prisma.sourceConnection.create({ data: { name: TAG, adapterKey: "synthetic", baseUrl: "https://example.test" } })).id;
    const mk = (code: string, districtId: string, extra: Record<string, unknown> = {}) =>
      prisma.candidate.create({ data: { sourceConnectionId: sourceId, sourceEmployeeCode: code, fullName: `${TAG} Person ${code}`, districtId, contentHash: "h", lastSyncedAt: new Date(), ...extra } });
    candA = (await mk("D0001", dA)).id;
    await mk("D0004", dA);
    candB = (await mk("D0002", dB, { reviewStatus: "SELECTED", reviewedAt: new Date() })).id;
    // One decision in district A by the viewer, awaiting confirmation; one in district B by the admin user.
    await prisma.candidate.update({ where: { id: candA }, data: { reviewStatus: "SELECTED", reviewPendingConfirmation: true, reviewedAt: new Date() } });
    await prisma.candidateReview.create({ data: { candidateId: candA, decision: "SELECTED", remark: "good fit", previousStatus: "PENDING_REVIEW", newStatus: "SELECTED", reviewedById: viewerId, districtId: dA, requiresConfirmation: true } });
    await prisma.candidateReview.create({ data: { candidateId: candB, decision: "SELECTED", remark: "other district", previousStatus: "PENDING_REVIEW", newStatus: "SELECTED", reviewedById: adminId, districtId: dB } });
    await prisma.candidateComment.create({ data: { candidateId: candB, authorId: adminId, body: `${TAG} beta comment` } });
  });

  afterAll(async () => {
    await prisma.candidate.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.sourceConnection.delete({ where: { id: sourceId } });
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } } });
    await prisma.district.deleteMany({ where: { name: { startsWith: TAG } } });
  });

  it("counts cover only the admin's districts", async () => {
    const c = await getDistrictCounts(admin());
    expect(c).toEqual({ total: 2, pending: 1, selected: 1, rejected: 0, awaiting: 1 });
    expect((await getDistrictCounts(global())).total).toBeGreaterThanOrEqual(3);
  });

  it("review table never shows district B, even with an explicit filter", async () => {
    const all = await getReviewTable(parseReviewFilters({ q: TAG }), admin());
    expect(all.rows.map((r) => r.sourceEmployeeCode).sort()).toEqual(["D0001", "D0004"]);
    expect(all.rows.find((r) => r.sourceEmployeeCode === "D0001")?.reviews[0]?.remark).toBe("good fit");
    const widened = await getReviewTable(parseReviewFilters({ q: TAG, districtId: dB }), admin());
    expect(widened.total).toBe(0);
    const awaiting = await getReviewTable(parseReviewFilters({ q: TAG, reviewStatus: "AWAITING_CONFIRMATION" }), admin());
    expect(awaiting.rows.map((r) => r.sourceEmployeeCode)).toEqual(["D0001"]);
    const byReviewer = await getReviewTable(parseReviewFilters({ q: TAG, reviewerId: adminId }), admin());
    expect(byReviewer.total).toBe(0); // the admin's own decision is in district B
  });

  it("activity, reviewer options and viewer list are scoped", async () => {
    const activity = await getRecentReviewActivity(admin());
    const texts = activity.map((a) => (a.kind === "review" ? a.r.candidate.sourceEmployeeCode : a.c.body));
    expect(texts).toContain("D0001");
    expect(texts).not.toContain("D0002");
    expect(texts).not.toContain(`${TAG} beta comment`);
    expect((await getReviewerOptions(admin())).map((o) => o.value)).toEqual([viewerId]);
    expect((await getDistrictViewers(admin())).map((v) => v.id)).toContain(viewerId);
  });

  it("viewer queue lists only the assigned district", async () => {
    const pending = await getViewerQueue(viewer(), "PENDING_REVIEW", 1, TAG);
    expect(pending.rows.map((r) => r.sourceEmployeeCode)).toEqual(["D0004"]);
    const all = await getViewerQueue(viewer(), "ALL", 1, TAG);
    expect(all.rows.map((r) => r.sourceEmployeeCode).sort()).toEqual(["D0001", "D0004"]);
    const byCode = await getViewerQueue(viewer(), "ALL", 1, "d0002");
    expect(byCode.total).toBe(0);
  });
  // Runs last: it adds district A candidates that the count assertions above do not expect.
  it("Verified Records lists only confirmed verified candidates in the admin's districts", async () => {
    const mk = (code: string, districtId: string, extra: Record<string, unknown>) =>
      prisma.candidate.create({ data: { sourceConnectionId: sourceId, sourceEmployeeCode: code, fullName: `${TAG} Person ${code}`, districtId, contentHash: "h", lastSyncedAt: new Date(), ...extra } });
    const ok = await mk("D0005", dA, { reviewStatus: "SELECTED", reviewedAt: new Date(), officialEmployeeId: "PMAY9001" });
    await prisma.candidateReview.create({ data: { candidateId: ok.id, decision: "SELECTED", remark: "verified", previousStatus: "PENDING_REVIEW", newStatus: "SELECTED", reviewedById: adminId, districtId: dA } });
    await mk("D0006", dA, { reviewStatus: "REJECTED", reviewedAt: new Date() });

    const v = await getVerifiedRecords(admin(), { q: TAG });
    // D0001 is verified but still awaiting confirmation; D0002 is another district; D0006 is rejected.
    expect(v.rows.map((r) => r.sourceEmployeeCode)).toEqual(["D0005"]);
    expect(v.rows[0]).toMatchObject({ officialEmployeeId: "PMAY9001", verifiedBy: `${TAG}-da@example.test` });
    expect((await getVerifiedRecords(admin(), { q: "pmay9001" })).total).toBe(1);
    expect((await getVerifiedRecords(admin(), { q: "D0002" })).total).toBe(0);
    expect((await getVerifiedRecords(global(), { q: TAG })).rows.map((r) => r.sourceEmployeeCode).sort()).toEqual(["D0002", "D0005"]);
  });
  it("every District Admin sees only their own district's verified users", async () => {
    const { NO_DISTRICT } = await import("@/lib/rbac");
    const codes = async (districtScopeIds: string[]) => (await getVerifiedRecords({ ...admin(), districtScopeIds }, { q: TAG })).rows.map((r) => r.sourceEmployeeCode).sort();
    expect(await codes([dA])).toEqual(["D0005"]); // admin of district A
    expect(await codes([dB])).toEqual(["D0002"]); // admin of district B
    expect(await codes([NO_DISTRICT])).toEqual([]); // District Admin with no district: nothing, never everything
  });
});
