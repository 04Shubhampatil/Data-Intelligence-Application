/** Report grouping against MySQL with SYNTHETIC rows (cleaned up afterwards). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CurrentUser } from "@/server/auth/session";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("report service (MySQL)", async () => {
  const { prisma } = await import("@di/db");
  const { getReport, groupCandidates, REPORT_KIND_KEYS } = await import("@/server/services/report.service");

  const TAG = `ZZREP${Date.now()}`;
  let sourceId = "";
  let dA = "", dB = "";
  const user = (scope: string[] = []): CurrentUser => ({ id: "u", username: "r@example.test", name: "R", role: "VIEWER", permissions: ["reports:read"], districtScopeIds: scope });

  beforeAll(async () => {
    sourceId = (await prisma.sourceConnection.create({ data: { name: TAG, adapterKey: "synthetic", baseUrl: "https://example.test" } })).id;
    dA = (await prisma.district.create({ data: { name: `${TAG} A` } })).id;
    dB = (await prisma.district.create({ data: { name: `${TAG} B` } })).id;
    const des = (await prisma.designation.create({ data: { name: `${TAG} ENGINEER` } })).id;
    const rows = [
      [dA, "Male", des], [dA, "Female", des], [dA, "Female", null], [dB, "Male", des],
    ] as const;
    let i = 0;
    for (const [districtId, gender, designationId] of rows) {
      await prisma.candidate.create({ data: { sourceConnectionId: sourceId, sourceEmployeeCode: `R${i++}`, fullName: "Synthetic", districtId, gender, designationId, contentHash: "h", lastSyncedAt: new Date() } });
    }
    // A record deleted at source must never be counted.
    await prisma.candidate.create({ data: { sourceConnectionId: sourceId, sourceEmployeeCode: "R99", fullName: "Gone", districtId: dA, contentHash: "h", lastSyncedAt: new Date(), isDeletedAtSource: true } });
  });

  afterAll(async () => {
    await prisma.candidate.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.sourceConnection.delete({ where: { id: sourceId } });
    await prisma.designation.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.district.deleteMany({ where: { name: { startsWith: TAG } } });
  });

  const onlyMine = () => ({ districtId: { in: [dA, dB] } });

  it("groups by a lookup column with names, and by a plain column", async () => {
    const byDistrict = await groupCandidates({ AND: [{ isDeletedAtSource: false }, onlyMine()] }, "district");
    expect(byDistrict).toEqual([
      { label: `${TAG} A`, count: 3, share: 0.75 },
      { label: `${TAG} B`, count: 1, share: 0.25 },
    ]);
    const byGender = await groupCandidates({ AND: [{ isDeletedAtSource: false }, onlyMine()] }, "gender");
    expect(byGender).toEqual(expect.arrayContaining([{ label: "Female", count: 2, share: 0.5 }, { label: "Male", count: 2, share: 0.5 }]));
  });

  it("labels nulls as Unassigned", async () => {
    const byDes = await groupCandidates({ AND: [{ isDeletedAtSource: false }, onlyMine()] }, "designation");
    expect(byDes).toEqual(expect.arrayContaining([{ label: `${TAG} ENGINEER`, count: 3, share: 0.75 }, { label: "Unassigned", count: 1, share: 0.25 }]));
  });

  it("getReport applies page filters and the user's district scope", async () => {
    const scoped = await getReport("gender", { districtId: dA }, user([dA, dB]));
    expect(scoped.total).toBe(3);
    const outOfScope = await getReport("gender", { districtId: dA }, user([dB]));
    expect(outOfScope.total).toBe(0);
  });

  it("every report kind runs", async () => {
    for (const kind of REPORT_KIND_KEYS) {
      const r = await getReport(kind, { districtId: dA }, user());
      expect(r.total).toBe(3);
      expect(r.groups.reduce((s, g) => s + g.count, 0)).toBe(3);
    }
  });
});
