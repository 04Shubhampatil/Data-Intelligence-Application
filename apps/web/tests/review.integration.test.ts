/**
 * Review rules (requirement 2026-11-01: decisions and review comments are Super Admin-only).
 * MySQL with synthetic users and candidates, cleaned up afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CurrentUser } from "@/server/auth/session";
import { DEFAULT_ROLE_PERMISSIONS, effectivePermissions, PERMISSIONS, type RoleName } from "@di/db/permissions";

const hasDb = !!process.env.DATABASE_URL;
const TAG = `ZZREV${Date.now()}`;

describe("decision permissions", () => {
  it("Super Admin and District Admin can decide; nobody else holds decision, confirm or comment permissions", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.DISTRICT_ADMIN).toEqual(expect.arrayContaining(["reviews:decide", "reviews:override"]));
    for (const role of ["ADMIN", "DISTRICT_VIEWER", "VIEWER"] as const) {
      for (const p of ["reviews:decide", "reviews:confirm", "reviews:override", "comments:write"] as const) expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain(p);
    }
    for (const role of ["ADMIN", "DISTRICT_ADMIN", "DISTRICT_VIEWER", "VIEWER"] as const) {
      for (const p of ["reviews:confirm", "comments:write"] as const) expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain(p);
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toContain("reviews:read"); // everyone can still read decisions
    }
  });

  it("a role row edited to include them only grants what the role is allowed", () => {
    expect(effectivePermissions("ADMIN", [...PERMISSIONS])).not.toEqual(expect.arrayContaining(["reviews:decide"]));
    expect(effectivePermissions("DISTRICT_VIEWER", ["reviews:read", "reviews:decide", "comments:write"])).toEqual(["reviews:read"]);
    expect(effectivePermissions("DISTRICT_ADMIN", ["reviews:read", "reviews:decide", "reviews:override", "reviews:confirm", "comments:write"])).toEqual(["reviews:read", "reviews:decide", "reviews:override"]);
    // The Super Admin always has every permission, even ones its stored role row doesn't list yet.
    expect(effectivePermissions("SUPER_ADMIN", ["reviews:read"])).toEqual([...PERMISSIONS]);
  });
});

describe.skipIf(!hasDb)("candidate review (MySQL)", async () => {
  const { prisma } = await import("@di/db");
  const { decideCandidate, confirmReview, addComment, getReviewTimeline } = await import("@/server/services/review.service");

  let sourceId = "", dA = "", dB = "", candA = "", candB = "", candC = "";
  const ids: Record<string, string> = {};
  /** Built like a real session: role permissions run through effectivePermissions. Extra grants simulate an edited role row. */
  const mkUser = (role: RoleName, scope: string[], extra: string[] = []): CurrentUser => ({
    id: ids[role], email: `${TAG}-${role}@example.test`, name: `${TAG} ${role}`, role,
    permissions: effectivePermissions(role, [...DEFAULT_ROLE_PERMISSIONS[role], ...(extra as never[])]),
    districtScopeIds: scope,
  });
  const superAdmin = () => mkUser("SUPER_ADMIN", []);

  beforeAll(async () => {
    for (const role of ["SUPER_ADMIN", "ADMIN", "DISTRICT_ADMIN", "DISTRICT_VIEWER", "VIEWER"] as const) {
      const r = await prisma.role.findUniqueOrThrow({ where: { name: role } });
      ids[role] = (await prisma.user.create({ data: { email: `${TAG.toLowerCase()}-${role.toLowerCase()}@example.test`, name: `${TAG} ${role}`, passwordHash: "x", roleId: r.id } })).id;
    }
    sourceId = (await prisma.sourceConnection.create({ data: { name: TAG, adapterKey: "synthetic", baseUrl: "https://example.test" } })).id;
    dA = (await prisma.district.create({ data: { name: `${TAG} A` } })).id;
    dB = (await prisma.district.create({ data: { name: `${TAG} B` } })).id;
    const mk = async (code: string, districtId: string) =>
      (await prisma.candidate.create({ data: { sourceConnectionId: sourceId, sourceEmployeeCode: code, fullName: `Rev ${code}`, districtId, contentHash: "h", lastSyncedAt: new Date() } })).id;
    candA = await mk("R1", dA);
    candB = await mk("R2", dB);
    candC = await mk("R3", dA);
  });
  afterAll(async () => {
    await prisma.candidate.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.sourceConnection.delete({ where: { id: sourceId } });
    await prisma.district.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: Object.values(ids) } } });
    await prisma.notification.deleteMany({ where: { userId: { in: Object.values(ids) } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  });

  it("1. Super Admin can select a candidate (no confirmation step)", async () => {
    const r = await decideCandidate({ candidateId: candA, decision: "SELECTED", remark: "Strong profile", user: superAdmin() });
    expect(r).toMatchObject({ previousStatus: "PENDING_REVIEW", newStatus: "SELECTED", isOverride: false, requiresConfirmation: false, reviewedById: ids.SUPER_ADMIN });
    expect(await prisma.candidate.findUniqueOrThrow({ where: { id: candA } })).toMatchObject({ reviewStatus: "SELECTED", reviewPendingConfirmation: false });
  });

  it("2. Super Admin can reject (a reason is required) and change an existing decision; history is appended, never overwritten", async () => {
    await expect(decideCandidate({ candidateId: candC, decision: "REJECTED", remark: "", user: superAdmin() })).rejects.toThrow(/reason is required/);
    const rej = await decideCandidate({ candidateId: candC, decision: "REJECTED", remark: "Certificates invalid", user: superAdmin() });
    expect(rej).toMatchObject({ newStatus: "REJECTED", isOverride: false });

    const changed = await decideCandidate({ candidateId: candA, decision: "REJECTED", remark: "Experience letter missing", user: superAdmin() });
    expect(changed).toMatchObject({ isOverride: true, previousStatus: "SELECTED", newStatus: "REJECTED" });
    const rows = await prisma.candidateReview.findMany({ where: { candidateId: candA }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.decision)).toEqual(["SELECTED", "REJECTED"]);
    expect((await prisma.candidate.findUniqueOrThrow({ where: { id: candA } })).reviewUpdated).toBe(true);
  });

  it("District Admin can select and reject in their own district, can't comment or confirm, and can't overrule the Super Admin", async () => {
    const da = mkUser("DISTRICT_ADMIN", [dA]);
    const cand = (await prisma.candidate.create({ data: { sourceConnectionId: sourceId, sourceEmployeeCode: "R9", fullName: "Rev DA", districtId: dA, contentHash: "h", lastSyncedAt: new Date() } })).id;
    const sel = await decideCandidate({ candidateId: cand, decision: "SELECTED", remark: "", user: da });
    expect(sel).toMatchObject({ newStatus: "SELECTED", reviewedById: ids.DISTRICT_ADMIN, requiresConfirmation: false });
    expect(await decideCandidate({ candidateId: cand, decision: "REJECTED", remark: "Experience letter missing", user: da })).toMatchObject({ isOverride: true, newStatus: "REJECTED" });
    // Other district → not found; comments → forbidden.
    await expect(decideCandidate({ candidateId: candB, decision: "SELECTED", remark: "", user: da })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(addComment({ candidateId: cand, body: "note", user: da })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // The Super Admin's decision on candA (rejected in test 2) can't be changed by a District Admin.
    await expect(decideCandidate({ candidateId: candA, decision: "SELECTED", remark: "", user: da })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await prisma.candidate.findUniqueOrThrow({ where: { id: candA } })).reviewStatus).toBe("REJECTED");
  });

  it.each(["ADMIN", "DISTRICT_VIEWER", "VIEWER"] as const)("3–5. %s cannot select, reject, confirm or comment — even with the permissions forced onto the role", async (role) => {
    const scope = role === "DISTRICT_VIEWER" ? [dA] : [];
    const forced = mkUser(role, scope, ["reviews:decide", "reviews:override", "reviews:confirm", "comments:write"]);
    // Even if permissions were somehow present, the service checks the role itself.
    const withPerms = { ...forced, permissions: [...forced.permissions, "reviews:decide", "reviews:override", "reviews:confirm", "comments:write"] as CurrentUser["permissions"] };
    for (const u of [forced, withPerms]) {
      await expect(decideCandidate({ candidateId: candC, decision: "SELECTED", remark: "x", user: u })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(decideCandidate({ candidateId: candC, decision: "REJECTED", remark: "not suitable", user: u })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(addComment({ candidateId: candC, body: "my note", user: u })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const legacy = await prisma.candidateReview.create({ data: { candidateId: candC, decision: "SELECTED", remark: "", previousStatus: "REJECTED", newStatus: "SELECTED", reviewedById: ids.SUPER_ADMIN, requiresConfirmation: true } });
    await expect(confirmReview(legacy.id, withPerms)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.candidateReview.delete({ where: { id: legacy.id } });
    // Status unchanged, refusal audited.
    expect((await prisma.candidate.findUniqueOrThrow({ where: { id: candC } })).reviewStatus).toBe("REJECTED");
    expect(await prisma.auditLog.count({ where: { userId: ids[role], action: "ACCESS_DENIED" } })).toBeGreaterThan(0);
  });

  it("Super Admin can add internal comments; comments are append-only", async () => {
    const c = await addComment({ candidateId: candA, body: "Verified with district office", user: superAdmin() });
    expect(c.authorId).toBe(ids.SUPER_ADMIN);
    expect(await prisma.candidateComment.count({ where: { candidateId: candA } })).toBe(1);
  });

  it("7. Admin, District Admin and District Viewer see the status, decision-maker, date and comments (read-only) in their districts", async () => {
    for (const u of [mkUser("ADMIN", []), mkUser("DISTRICT_ADMIN", [dA]), mkUser("DISTRICT_VIEWER", [dA])]) {
      const t = await getReviewTimeline(candA, u);
      expect(t.reviews.map((r) => r.decision)).toEqual(["REJECTED", "SELECTED"]); // newest first
      expect(t.reviews[0]).toMatchObject({ remark: "Experience letter missing", reviewedBy: { name: `${TAG} SUPER_ADMIN`, role: { name: "SUPER_ADMIN" } } });
      expect(t.reviews[0].createdAt).toBeInstanceOf(Date);
      expect(t.comments.map((c) => c.body)).toEqual(["Verified with district office"]);
    }
  });

  it("8. nobody sees decisions, comments or the record outside their assigned district", async () => {
    await addComment({ candidateId: candB, body: "District B note", user: superAdmin() });
    for (const u of [mkUser("DISTRICT_ADMIN", [dA]), mkUser("DISTRICT_VIEWER", [dA])]) {
      expect(await getReviewTimeline(candB, u)).toEqual({ reviews: [], comments: [] });
    }
    expect((await getReviewTimeline(candB, mkUser("DISTRICT_VIEWER", [dB]))).comments.map((c) => c.body)).toEqual(["District B note"]);
  });
});
