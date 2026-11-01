/** Review rules against MySQL with synthetic users and candidates (cleaned up). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CurrentUser } from "@/server/auth/session";
import { DEFAULT_ROLE_PERMISSIONS } from "@di/db/permissions";

const hasDb = !!process.env.DATABASE_URL;
const TAG = `ZZREV${Date.now()}`;

describe.skipIf(!hasDb)("candidate review", async () => {
  const { prisma } = await import("@di/db");
  const { decideCandidate, confirmReview, addComment, getReviewTimeline, ReviewError } = await import("@/server/services/review.service");

  let sourceId = "", dA = "", dB = "", candA = "", candB = "";
  const ids: Record<string, string> = {};
  const mkUser = (role: keyof typeof DEFAULT_ROLE_PERMISSIONS, scope: string[]): CurrentUser => ({
    id: ids[role], email: `${TAG}-${role}@example.test`, name: role, role, permissions: [...DEFAULT_ROLE_PERMISSIONS[role]], districtScopeIds: scope,
  });

  beforeAll(async () => {
    for (const role of ["ADMIN", "DISTRICT_ADMIN", "DISTRICT_VIEWER", "VIEWER"] as const) {
      const r = await prisma.role.findUniqueOrThrow({ where: { name: role } });
      ids[role] = (await prisma.user.create({ data: { email: `${TAG}-${role}@example.test`, passwordHash: "x", roleId: r.id } })).id;
    }
    sourceId = (await prisma.sourceConnection.create({ data: { name: TAG, adapterKey: "synthetic", baseUrl: "https://example.test" } })).id;
    dA = (await prisma.district.create({ data: { name: `${TAG} A` } })).id;
    dB = (await prisma.district.create({ data: { name: `${TAG} B` } })).id;
    candA = (await prisma.candidate.create({ data: { sourceConnectionId: sourceId, sourceEmployeeCode: "R1", fullName: "Rev A", districtId: dA, contentHash: "h", lastSyncedAt: new Date() } })).id;
    candB = (await prisma.candidate.create({ data: { sourceConnectionId: sourceId, sourceEmployeeCode: "R2", fullName: "Rev B", districtId: dB, contentHash: "h", lastSyncedAt: new Date() } })).id;
  });
  afterAll(async () => {
    await prisma.candidate.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.sourceConnection.delete({ where: { id: sourceId } });
    await prisma.district.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: Object.values(ids) } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  });

  it("rejection needs a reason; selection does not", async () => {
    const admin = mkUser("ADMIN", []);
    await expect(decideCandidate({ candidateId: candA, decision: "REJECTED", remark: "", user: admin })).rejects.toThrow(/reason is required/);
    const r = await decideCandidate({ candidateId: candA, decision: "SELECTED", remark: "", user: admin });
    expect(r).toMatchObject({ previousStatus: "PENDING_REVIEW", newStatus: "SELECTED", isOverride: false, requiresConfirmation: false });
    const c = await prisma.candidate.findUniqueOrThrow({ where: { id: candA } });
    expect(c).toMatchObject({ reviewStatus: "SELECTED", reviewUpdated: false, reviewPendingConfirmation: false });
  });

  it("a Viewer cannot decide; a District Viewer cannot touch another district (404-style)", async () => {
    await expect(decideCandidate({ candidateId: candB, decision: "SELECTED", remark: "", user: mkUser("VIEWER", []) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(decideCandidate({ candidateId: candB, decision: "SELECTED", remark: "", user: mkUser("DISTRICT_VIEWER", [dA]) })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("changing an existing decision requires override and is recorded as a new row", async () => {
    const dv = mkUser("DISTRICT_VIEWER", [dA]);
    await expect(decideCandidate({ candidateId: candA, decision: "REJECTED", remark: "not suitable", user: dv })).rejects.toMatchObject({ code: "CONFLICT" });
    const admin = mkUser("ADMIN", []);
    await expect(decideCandidate({ candidateId: candA, decision: "SELECTED", remark: "", user: admin })).rejects.toThrow(/already selected/);
    const r = await decideCandidate({ candidateId: candA, decision: "REJECTED", remark: "Certificates invalid", user: admin });
    expect(r).toMatchObject({ isOverride: true, previousStatus: "SELECTED", newStatus: "REJECTED" });
    expect(r.overridesId).toBeTruthy();
    const rows = await prisma.candidateReview.findMany({ where: { candidateId: candA }, orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2); // append-only: first decision still there, untouched
    expect(rows[0]).toMatchObject({ decision: "SELECTED", newStatus: "SELECTED" });
    expect((await prisma.candidate.findUniqueOrThrow({ where: { id: candA } })).reviewUpdated).toBe(true);
  });

  it("District Viewer decisions wait for confirmation; confirmer must be someone else with the permission", async () => {
    const dv = mkUser("DISTRICT_VIEWER", [dB]);
    const r = await decideCandidate({ candidateId: candB, decision: "SELECTED", remark: "", user: dv });
    expect(r.requiresConfirmation).toBe(true);
    expect((await prisma.candidate.findUniqueOrThrow({ where: { id: candB } })).reviewPendingConfirmation).toBe(true);

    // District Admin without reviews:confirm (default) → forbidden; DA in another district → not found; Admin → ok.
    await expect(confirmReview(r.id, mkUser("DISTRICT_ADMIN", [dB]))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const daWithConfirm = { ...mkUser("DISTRICT_ADMIN", [dA]), permissions: [...DEFAULT_ROLE_PERMISSIONS.DISTRICT_ADMIN, "reviews:confirm" as const] };
    await expect(confirmReview(r.id, daWithConfirm)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await confirmReview(r.id, mkUser("ADMIN", []));
    const after = await prisma.candidateReview.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.confirmedById).toBe(ids.ADMIN);
    expect((await prisma.candidate.findUniqueOrThrow({ where: { id: candB } })).reviewPendingConfirmation).toBe(false);
    await expect(confirmReview(r.id, mkUser("ADMIN", []))).rejects.toMatchObject({ code: "NOT_FOUND" }); // already confirmed
  });

  it("comments are scoped and appended; timeline hides everything outside scope", async () => {
    const dv = mkUser("DISTRICT_VIEWER", [dB]);
    await addComment({ candidateId: candB, body: "Checked documents", user: dv });
    await expect(addComment({ candidateId: candA, body: "nope", user: dv })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const mine = await getReviewTimeline(candB, dv);
    expect(mine.comments).toHaveLength(1);
    expect(mine.reviews).toHaveLength(1);
    const foreign = await getReviewTimeline(candA, dv);
    expect(foreign).toEqual({ reviews: [], comments: [] });
    expect(ReviewError).toBeDefined();
  });
});
