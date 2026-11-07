/**
 * Cross-district access-denial tests (MySQL, synthetic data, cleaned up).
 * A user scoped to district A must never see, count, export or be told about district B.
 */
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/server/auth/session";

const hasDb = !!process.env.DATABASE_URL;
const TAG = `ZZISO${Date.now()}`;

// The report-export route reads the user through authorizeApi; point it at whichever user the test sets.
let routeUser: CurrentUser | null = null;
vi.mock("@/server/auth/session", async () => ({
  authorizeApi: async () => (routeUser ? { user: routeUser } : { error: Response.json({ error: "Unauthorized" }, { status: 401 }) }),
  requireUser: async () => routeUser,
  getCurrentUser: async () => routeUser,
}));

describe.skipIf(!hasDb)("district isolation", async () => {
  const { prisma } = await import("@di/db");
  const { listCandidates, getCandidate } = await import("@/server/services/candidate.service");
  const { getFilterOptions } = await import("@/server/services/lookup.service");
  const { getReport } = await import("@/server/services/report.service");
  const { getDashboardData } = await import("@/server/services/dashboard.service");
  const { executeTool, rowsForResult } = await import("@/server/ai/tools");
  const { recordAccessDeniedIfExists, districtInScope } = await import("@/server/auth/scope");
  const { GET: exportReport } = await import("@/app/api/reports/export/route");
  const { candidateFilterSchema } = await import("@/lib/validation/candidates");

  let sourceId = "", dA = "", dB = "", projA = "", projB = "", candA = "", candB = "", candNone = "", scopedUserId = "";

  const scoped = (): CurrentUser => ({ id: scopedUserId, username: `${TAG}@example.test`, name: "Scoped", role: "DISTRICT_VIEWER", permissions: ["candidates:read", "reports:read", "reports:export", "assistant:use", "dashboard:read"], districtScopeIds: [dA] });
  const global = (): CurrentUser => ({ ...scoped(), role: "ADMIN", districtScopeIds: [] });
  const filters = (o: Record<string, string> = {}) => candidateFilterSchema.parse(o);

  beforeAll(async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "DISTRICT_VIEWER" } });
    scopedUserId = (await prisma.user.create({ data: { username: `${TAG}@example.test`, passwordHash: "x", roleId: role.id } })).id;
    sourceId = (await prisma.sourceConnection.create({ data: { name: TAG, adapterKey: "synthetic", baseUrl: "https://example.test" } })).id;
    dA = (await prisma.district.create({ data: { name: `${TAG} ALPHA` } })).id;
    dB = (await prisma.district.create({ data: { name: `${TAG} BETA` } })).id;
    projA = (await prisma.departmentHead.create({ data: { name: `${TAG} PROJECT A` } })).id;
    projB = (await prisma.departmentHead.create({ data: { name: `${TAG} PROJECT B` } })).id;
    const mk = (code: string, districtId: string | null, departmentHeadId: string) =>
      prisma.candidate.create({ data: { sourceConnectionId: sourceId, sourceEmployeeCode: code, fullName: `${TAG} Person ${code}`, districtId, departmentHeadId, contentHash: "h", lastSyncedAt: new Date() } });
    candA = (await mk("I0001", dA, projA)).id;
    candB = (await mk("I0002", dB, projB)).id;
    candNone = (await mk("I0003", null, projA)).id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: scopedUserId } });
    await prisma.assistantResult.deleteMany({ where: { userId: scopedUserId } });
    await prisma.reportRun.deleteMany({ where: { userId: scopedUserId } });
    await prisma.candidate.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.sourceConnection.delete({ where: { id: sourceId } });
    await prisma.departmentHead.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.district.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.user.delete({ where: { id: scopedUserId } });
  });

  it("records list: scoped user sees only district A; global user sees A, B and the unassigned record", async () => {
    const mine = await listCandidates(filters({ q: TAG }), scoped());
    expect(mine.rows.map((r) => r.sourceEmployeeCode)).toEqual(["I0001"]);
    const all = await listCandidates(filters({ q: TAG }), global());
    expect(all.rows.map((r) => r.sourceEmployeeCode).sort()).toEqual(["I0001", "I0002", "I0003"]);
  });

  it("an explicit district filter outside the scope cannot widen it", async () => {
    const r = await listCandidates(filters({ q: TAG, districtId: dB }), scoped());
    expect(r.total).toBe(0);
  });

  it("detail by id: foreign and unassigned records look like 404 and the probe is audited", async () => {
    expect(await getCandidate(candA, scoped())).not.toBeNull();
    expect(await getCandidate(candB, scoped())).toBeNull();
    expect(await getCandidate(candNone, scoped())).toBeNull();
    await recordAccessDeniedIfExists(scoped(), candB, "test");
    expect(await prisma.auditLog.count({ where: { userId: scopedUserId, action: "ACCESS_DENIED", target: candB } })).toBe(1);
    // A genuinely missing id is not an access-denied event.
    await recordAccessDeniedIfExists(scoped(), "doesnotexist", "test");
    expect(await prisma.auditLog.count({ where: { userId: scopedUserId, action: "ACCESS_DENIED" } })).toBe(1);
    expect(districtInScope(scoped(), null)).toBe(false);
    expect(districtInScope(global(), null)).toBe(true);
  });

  it("filter options and AI vocabulary never list the other district's values", async () => {
    const opts = await getFilterOptions(scoped());
    expect(opts.districts.map((d) => d.label)).toEqual([`${TAG} ALPHA`]);
    expect(opts.departmentHeads.map((d) => d.label)).toContain(`${TAG} PROJECT A`);
    expect(opts.departmentHeads.map((d) => d.label)).not.toContain(`${TAG} PROJECT B`);

    const vals = await executeTool("list_filter_values", { kind: "project", contains: TAG }, scoped());
    const names = (vals as { outcome: { forModel: { values: string[] } } }).outcome.forModel.values;
    expect(names).toContain(`${TAG} PROJECT A`);
    expect(names).not.toContain(`${TAG} PROJECT B`);
  });

  it("reports and dashboard are scoped", async () => {
    const rep = await getReport("district", filters({ q: TAG }), scoped());
    expect(rep.total).toBe(1);
    expect(rep.groups.map((g) => g.label)).toEqual([`${TAG} ALPHA`]);
    const dash = await getDashboardData(scoped());
    expect(dash.byDistrict.map((g) => g.label)).not.toContain(`${TAG} BETA`);
    expect(dash.unassignedDistrict).toBe(0); // only global users are told about unassigned records
    expect((await getDashboardData(global())).unassignedDistrict).toBeGreaterThanOrEqual(1);
  });

  it("AI tools: search/count/details/report all stay inside the scope even when asked for district B", async () => {
    const search = await executeTool("search_candidates", { filters: { nameContains: TAG } }, scoped());
    expect((search as unknown as { outcome: { tables: { rows: { code: string }[] }[] } }).outcome.tables[0].rows.map((r) => r.code)).toEqual(["I0001"]);

    const countB = await executeTool("count_candidates", { filters: { district: `${TAG} BETA` } }, scoped());
    // Either the name doesn't resolve for this user, or it resolves to zero — never to district B's data.
    expect(countB.ok ? (countB as { outcome: { forModel: { total: number } } }).outcome.forModel.total : 0).toBe(0);

    const details = await executeTool("get_candidate_details", { employeeCode: "I0002" }, scoped());
    expect((details as { outcome: { forModel: { found: number } } }).outcome.forModel.found).toBe(0);

    const report = await executeTool("generate_candidate_report", { filters: { nameContains: TAG }, groupBy: "district" }, scoped());
    const rows = (report as unknown as { outcome: { tables: { rows: { label: string }[] }[] } }).outcome.tables[0].rows;
    expect(rows.map((r) => r.label)).toEqual([`${TAG} ALPHA`]);

    // Excel re-run of a saved result is also scoped by the *current* user, not the saved parameters.
    const saved = await prisma.assistantResult.findFirst({ where: { userId: scopedUserId, tool: "search_candidates" }, orderBy: { createdAt: "desc" } });
    const rerun = await rowsForResult(saved!, scoped());
    expect(rerun.rows.map((r) => r.code)).toEqual(["I0001"]);
  });

  it("report export route: the workbook contains only district A rows", async () => {
    routeUser = scoped();
    const res = await exportReport(new Request(`http://localhost/api/reports/export?kind=district&q=${TAG}`));
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    const codes = wb.getWorksheet("Candidates")!.getSheetValues().slice(2).map((r) => (r as unknown[])[1]);
    expect(codes).toEqual(["I0001"]);
    routeUser = null;
  });
});
