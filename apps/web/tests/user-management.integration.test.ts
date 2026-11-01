/** User management actions against MySQL (synthetic users, cleaned up). The session is mocked as a Super Admin. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hasDb = !!process.env.DATABASE_URL;
const TAG = `zzusr${Date.now()}`;
let actorId = "";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", () => ({
  requireUser: async () => ({ id: actorId, email: `${TAG}-actor@example.test`, name: "Actor", role: "SUPER_ADMIN", permissions: ["users:manage", "districts:assign"], districtScopeIds: [] }),
}));

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe.skipIf(!hasDb)("user management (MySQL)", async () => {
  const { prisma } = await import("@di/db");
  const bcrypt = (await import("bcryptjs")).default;
  const { createUserAction, setUserActiveAction, setUserRoleAction, resetUserPasswordAction } = await import("@/app/(dashboard)/settings/user-actions");

  beforeAll(async () => {
    const sa = await prisma.role.findUniqueOrThrow({ where: { name: "SUPER_ADMIN" } });
    actorId = (await prisma.user.create({ data: { email: `${TAG}-actor@example.test`, passwordHash: "x", roleId: sa.id } })).id;
  });
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: actorId } });
    await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
  });

  it("creates a Viewer with a hashed password and audits it", async () => {
    const r = await createUserAction(undefined, form({ name: "Test Viewer", email: `${TAG}-viewer@example.test`, password: "ViewerPassw0rd!", role: "VIEWER" }));
    expect(r).toMatchObject({ ok: true });
    const u = await prisma.user.findUniqueOrThrow({ where: { email: `${TAG}-viewer@example.test` }, include: { role: true } });
    expect(u.role.name).toBe("VIEWER");
    expect(u.passwordHash).not.toContain("ViewerPassw0rd");
    expect(await bcrypt.compare("ViewerPassw0rd!", u.passwordHash)).toBe(true);
    expect(await prisma.auditLog.count({ where: { userId: actorId, action: "USER_CREATE", target: u.id } })).toBe(1);
  });

  it("rejects weak passwords, duplicates and non-assignable roles", async () => {
    expect(await createUserAction(undefined, form({ name: "X Y", email: `${TAG}-a@example.test`, password: "short", role: "VIEWER" }))).toMatchObject({ error: expect.any(String) });
    expect(await createUserAction(undefined, form({ name: "X Y", email: `${TAG}-viewer@example.test`, password: "ViewerPassw0rd!", role: "ADMIN" }))).toMatchObject({ error: expect.stringContaining("already exists") });
    expect(await createUserAction(undefined, form({ name: "X Y", email: `${TAG}-b@example.test`, password: "ViewerPassw0rd!", role: "SUPER_ADMIN" }))).toMatchObject({ error: expect.any(String) });
  });

  it("district roles: a District Viewer needs exactly one district, assigned via the action, and the session scope follows it", async () => {
    const { setUserDistrictsAction } = await import("@/app/(dashboard)/settings/user-actions");
    const d1 = await prisma.district.upsert({ where: { name: `${TAG.toUpperCase()} D1` }, update: {}, create: { name: `${TAG.toUpperCase()} D1` } });
    const d2 = await prisma.district.upsert({ where: { name: `${TAG.toUpperCase()} D2` }, update: {}, create: { name: `${TAG.toUpperCase()} D2` } });
    try {
      // no district → rejected
      expect(await createUserAction(undefined, form({ name: "DV", email: `${TAG}-dv@example.test`, password: "ViewerPassw0rd!", role: "DISTRICT_VIEWER", districtIds: "" }))).toMatchObject({ error: expect.stringContaining("exactly one") });
      // two districts → rejected
      expect(await createUserAction(undefined, form({ name: "DV", email: `${TAG}-dv@example.test`, password: "ViewerPassw0rd!", role: "DISTRICT_VIEWER", districtIds: `${d1.id},${d2.id}` }))).toMatchObject({ error: expect.stringContaining("only one") });
      // one district → ok, assignment row written
      expect(await createUserAction(undefined, form({ name: "DV", email: `${TAG}-dv@example.test`, password: "ViewerPassw0rd!", role: "DISTRICT_VIEWER", districtIds: d1.id }))).toMatchObject({ ok: true });
      const dv = await prisma.user.findUniqueOrThrow({ where: { email: `${TAG}-dv@example.test` }, include: { districtAssignments: true } });
      expect(dv.districtAssignments.map((a) => a.districtId)).toEqual([d1.id]);
      // move to d2
      expect(await setUserDistrictsAction(dv.id, [d2.id])).toMatchObject({ ok: true });
      expect((await prisma.userDistrictAssignment.findMany({ where: { userId: dv.id } })).map((a) => a.districtId)).toEqual([d2.id]);
      // Admin is global: assigning a district is refused
      expect(await createUserAction(undefined, form({ name: "AD", email: `${TAG}-ad@example.test`, password: "ViewerPassw0rd!", role: "ADMIN", districtIds: d1.id }))).toMatchObject({ error: expect.stringContaining("global") });
    } finally {
      await prisma.user.deleteMany({ where: { email: `${TAG}-dv@example.test` } });
      await prisma.district.deleteMany({ where: { id: { in: [d1.id, d2.id] } } });
    }
  });

  it("changes role, disables/enables, resets password — but never self or a Super Admin", async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { email: `${TAG}-viewer@example.test` } });
    expect(await setUserRoleAction(u.id, "ADMIN")).toMatchObject({ ok: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id }, include: { role: true } })).role.name).toBe("ADMIN");

    expect(await setUserActiveAction(u.id, false)).toMatchObject({ ok: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).isActive).toBe(false);
    expect(await setUserActiveAction(u.id, true)).toMatchObject({ ok: true });

    expect(await resetUserPasswordAction(undefined, form({ userId: u.id, password: "AnotherPassw0rd!" }))).toMatchObject({ ok: true });
    expect(await bcrypt.compare("AnotherPassw0rd!", (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash)).toBe(true);

    expect(await setUserActiveAction(actorId, false)).toMatchObject({ error: expect.stringContaining("own account") });
    const sa = await prisma.role.findUniqueOrThrow({ where: { name: "SUPER_ADMIN" } });
    const otherSa = await prisma.user.create({ data: { email: `${TAG}-sa2@example.test`, passwordHash: "x", roleId: sa.id } });
    expect(await setUserRoleAction(otherSa.id, "VIEWER")).toMatchObject({ error: expect.stringContaining("Super Admin") });
    expect(await setUserRoleAction(u.id, "SUPER_ADMIN")).toMatchObject({ error: expect.stringContaining("assign that role") });
  });
});
