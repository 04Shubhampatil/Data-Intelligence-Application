/**
 * Who can read "Profile & employment" details (MySQL, synthetic data, cleaned up):
 * permission + district scope required, each read audited, tampered rows show nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CurrentUser } from "@/server/auth/session";

const hasDb = !!process.env.DATABASE_URL && !!process.env.CREDENTIALS_ENCRYPTION_KEY;
const TAG = `ZZPA${Date.now()}`;

describe.skipIf(!hasDb)("personal details access", async () => {
  const { prisma } = await import("@di/db");
  const { encryptSecret, personalAad } = await import("@di/core");
  const { getPersonalDetails } = await import("@/server/services/personal.service");
  const { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } = await import("@di/db/permissions");

  let sourceId = "", dA = "", dB = "", candA = "", candB = "", userId = "";
  const user = (perms: string[], scope: string[]): CurrentUser => ({ id: userId, email: `${TAG}@example.test`, name: "T", role: "ADMIN", permissions: perms as CurrentUser["permissions"], districtScopeIds: scope });

  beforeAll(async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "VIEWER" } });
    userId = (await prisma.user.create({ data: { email: `${TAG.toLowerCase()}@example.test`, passwordHash: "x", roleId: role.id } })).id;
    sourceId = (await prisma.sourceConnection.create({ data: { name: TAG, adapterKey: "synthetic", baseUrl: "https://example.test" } })).id;
    dA = (await prisma.district.create({ data: { name: `${TAG} A` } })).id;
    dB = (await prisma.district.create({ data: { name: `${TAG} B` } })).id;
    const mk = async (code: string, districtId: string) => {
      const id = (await prisma.candidate.create({ data: { sourceConnectionId: sourceId, sourceEmployeeCode: code, fullName: `${TAG} ${code}`, districtId, contentHash: "h", lastSyncedAt: new Date() } })).id;
      const blob = encryptSecret(JSON.stringify({ fatherOrHusbandName: "Synthetic Father", education: [], employment: [], nominees: [] }), undefined, personalAad(id));
      await prisma.candidateProfile.create({ data: { candidateId: id, personalEncrypted: blob, personalHash: "x" } });
      return id;
    };
    candA = await mk("P0001", dA);
    candB = await mk("P0002", dB);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.candidate.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.sourceConnection.delete({ where: { id: sourceId } });
    await prisma.district.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("only Super Admin and District Admin have the permission by default", () => {
    expect(PERMISSIONS).toContain("candidates:read_personal");
    expect(DEFAULT_ROLE_PERMISSIONS.DISTRICT_ADMIN).toContain("candidates:read_personal");
    for (const r of ["ADMIN", "DISTRICT_VIEWER", "VIEWER"] as const) expect(DEFAULT_ROLE_PERMISSIONS[r]).not.toContain("candidates:read_personal");
  });

  it("requires the permission", async () => {
    expect(await getPersonalDetails(candA, user(["candidates:read"], []))).toEqual({ state: "forbidden" });
  });

  it("decrypts in scope, audits the read, and shows nothing outside the user's districts", async () => {
    const ok = await getPersonalDetails(candA, user(["candidates:read_personal"], [dA]));
    expect(ok).toMatchObject({ state: "ok", details: { fatherOrHusbandName: "Synthetic Father" } });
    expect(await prisma.auditLog.count({ where: { userId, action: "PERSONAL_VIEW", target: candA } })).toBe(1);
    expect(await getPersonalDetails(candB, user(["candidates:read_personal"], [dA]))).toEqual({ state: "none" });
    expect(await prisma.auditLog.count({ where: { userId, action: "PERSONAL_VIEW", target: candB } })).toBe(0);
  });

  it("a ciphertext moved to another candidate is unreadable, never shown", async () => {
    const a = await prisma.candidateProfile.findUniqueOrThrow({ where: { candidateId: candA } });
    await prisma.candidateProfile.update({ where: { candidateId: candB }, data: { personalEncrypted: a.personalEncrypted } });
    expect(await getPersonalDetails(candB, user(["candidates:read_personal"], []))).toEqual({ state: "unreadable" });
  });
});
