/**
 * 6. Direct API calls: only the Super Admin may POST decisions or comments; every other role
 * gets HTTP 403 and nothing changes. Reading history stays district-scoped.
 * MySQL with synthetic data (cleaned up). The session is mocked; everything else is real.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/server/auth/session";
import { DEFAULT_ROLE_PERMISSIONS, effectivePermissions, type RoleName } from "@di/db/permissions";
import { hasPermission } from "@/lib/rbac";

const hasDb = !!process.env.DATABASE_URL;
const TAG = `ZZRAPI${Date.now()}`;

let current: CurrentUser | null = null;
vi.mock("@/server/auth/session", () => ({
  authorizeApi: async (permission: Parameters<typeof hasPermission>[1]) => {
    if (!current) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
    if (!hasPermission(current.permissions, permission)) return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
    return { user: current };
  },
  requireUser: async () => current,
  getCurrentUser: async () => current,
}));

describe.skipIf(!hasDb)("review API authorization", async () => {
  const { prisma } = await import("@di/db");
  const decision = await import("@/app/api/candidates/[id]/decision/route");
  const comments = await import("@/app/api/candidates/[id]/comments/route");

  let sourceId = "", dA = "", dB = "", candA = "", candB = "", candC = "";
  const ids: Record<string, string> = {};
  const as = (role: RoleName, scope: string[] = []): CurrentUser => ({
    id: ids[role], username: `${TAG}-${role}@example.test`, name: `${TAG} ${role}`, role,
    permissions: effectivePermissions(role, [...DEFAULT_ROLE_PERMISSIONS[role]]), districtScopeIds: scope,
  });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/x", { method: "POST", headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost", ...headers }, body: JSON.stringify(body) });

  beforeAll(async () => {
    for (const role of ["SUPER_ADMIN", "ADMIN", "DISTRICT_ADMIN", "DISTRICT_VIEWER"] as const) {
      const r = await prisma.role.findUniqueOrThrow({ where: { name: role } });
      ids[role] = (await prisma.user.create({ data: { username: `${TAG.toLowerCase()}-${role.toLowerCase()}@example.test`, name: `${TAG} ${role}`, passwordHash: "x", roleId: r.id } })).id;
    }
    sourceId = (await prisma.sourceConnection.create({ data: { name: TAG, adapterKey: "synthetic", baseUrl: "https://example.test" } })).id;
    dA = (await prisma.district.create({ data: { name: `${TAG} A` } })).id;
    dB = (await prisma.district.create({ data: { name: `${TAG} B` } })).id;
    const mk = async (code: string, districtId: string) =>
      (await prisma.candidate.create({ data: { sourceConnectionId: sourceId, sourceEmployeeCode: code, fullName: `Api ${code}`, districtId, contentHash: "h", lastSyncedAt: new Date() } })).id;
    candA = await mk("Q1", dA);
    candB = await mk("Q2", dB);
    candC = await mk("Q3", dA);
  });
  afterAll(async () => {
    current = null;
    await prisma.candidate.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.sourceConnection.delete({ where: { id: sourceId } });
    await prisma.district.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: Object.values(ids) } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  });

  it("unauthenticated requests get 401", async () => {
    current = null;
    expect((await decision.POST(post({ decision: "SELECTED" }), ctx(candA))).status).toBe(401);
  });

  it.each([
    ["ADMIN", []],
    ["DISTRICT_VIEWER", ["A"]],
  ] as const)("%s gets 403 for select, reject and comment, and nothing changes", async (role, scope) => {
    current = as(role, scope.map(() => dA));
    for (const body of [{ decision: "SELECTED" }, { decision: "REJECTED", remark: "Not suitable at all" }]) {
      const res = await decision.POST(post(body), ctx(candA));
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: expect.stringMatching(/Super Admin or a District Admin/) });
    }
    expect((await comments.POST(post({ body: "note" }), ctx(candA))).status).toBe(403);
    expect(await prisma.candidateReview.count({ where: { candidateId: candA } })).toBe(0);
    expect(await prisma.candidateComment.count({ where: { candidateId: candA } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { userId: ids[role], action: "ACCESS_DENIED" } })).toBeGreaterThanOrEqual(3);
  });

  it("District Admin can select / reject in their own district only, and can't comment", async () => {
    current = as("DISTRICT_ADMIN", [dA]);
    const sel = await decision.POST(post({ decision: "SELECTED", remark: "Good fit" }), ctx(candC));
    expect(sel.status).toBe(200);
    expect(await sel.json()).toMatchObject({ ok: true, status: "SELECTED" });
    const changed = await decision.POST(post({ decision: "REJECTED", remark: "Documents incomplete" }), ctx(candC));
    expect(await changed.json()).toMatchObject({ ok: true, status: "REJECTED", changedFrom: "SELECTED" }); // own decision can be changed
    expect((await decision.POST(post({ decision: "SELECTED" }), ctx(candB))).status).toBe(404); // other district: looks like it doesn't exist
    expect(await prisma.candidateReview.count({ where: { candidateId: candB } })).toBe(0);
    expect((await comments.POST(post({ body: "note" }), ctx(candC))).status).toBe(403);
  });

  it("Super Admin can select, reject and comment through the API", async () => {
    current = as("SUPER_ADMIN");
    const sel = await decision.POST(post({ decision: "SELECTED", remark: "Good fit" }), ctx(candA));
    expect(sel.status).toBe(200);
    expect(await sel.json()).toMatchObject({ ok: true, status: "SELECTED", changedFrom: null });
    const rej = await decision.POST(post({ decision: "REJECTED", remark: "Experience letter missing" }), ctx(candA));
    expect(await rej.json()).toMatchObject({ ok: true, status: "REJECTED", changedFrom: "SELECTED" });
    expect((await decision.POST(post({ decision: "REJECTED" }), ctx(candB))).status).toBe(400); // reason required
    expect((await comments.POST(post({ body: "Checked with the district office" }), ctx(candA))).status).toBe(201);
    expect((await decision.POST(post({ decision: "MAYBE" }), ctx(candA))).status).toBe(400);
    expect((await decision.POST(post({ decision: "SELECTED" }), ctx("doesnotexist"))).status).toBe(404);
  });

  it("a District Admin can't change a decision the Super Admin made", async () => {
    current = as("DISTRICT_ADMIN", [dA]);
    const res = await decision.POST(post({ decision: "SELECTED" }), ctx(candA)); // Super Admin rejected it above
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/only the Super Admin can change it/) });
    expect(await prisma.candidate.findUniqueOrThrow({ where: { id: candA }, select: { reviewStatus: true } })).toEqual({ reviewStatus: "REJECTED" });
  });

  it("refuses cross-site and non-JSON requests even from the Super Admin", async () => {
    current = as("SUPER_ADMIN");
    expect((await decision.POST(post({ decision: "SELECTED" }, { origin: "https://evil.example" }), ctx(candB))).status).toBe(403);
    expect((await comments.POST(post({ body: "x" }, { "content-type": "text/plain" }), ctx(candB))).status).toBe(415);
  });

  it("reading history: in-scope roles see status and Super Admin comments; other districts get 404", async () => {
    current = as("DISTRICT_VIEWER", [dA]);
    const ok = await comments.GET(new Request("http://localhost"), ctx(candA));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.status).toBe("REJECTED");
    expect(body.decisions[0]).toMatchObject({ decision: "REJECTED", by: `${TAG} SUPER_ADMIN`, byRole: "SUPER_ADMIN", remark: "Experience letter missing" });
    expect(body.comments.map((c: { body: string }) => c.body)).toEqual(["Checked with the district office"]);
    expect((await comments.GET(new Request("http://localhost"), ctx(candB))).status).toBe(404);
  });
});
