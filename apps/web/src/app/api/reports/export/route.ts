import { prisma } from "@di/db";
import { authorizeApi } from "@/server/auth/session";
import { buildCandidateWhere } from "@/server/services/candidate.service";
import { groupCandidates, isReportKind, REPORT_KINDS } from "@/server/services/report.service";
import { projectRow } from "@/server/ai/tools";
import { buildCandidatesWorkbook } from "@/server/excel/candidates-workbook";
import { candidateFilterSchema } from "@/lib/validation/candidates";
import { audit } from "@/server/security/audit";
import { rateLimit } from "@/server/security/rate-limit";

const ROW_SELECT = {
  sourceEmployeeCode: true, fullName: true, gender: true, employeeType: true, taluka: true, joiningDate: true, sourceStatus: true, docVerificationStatus: true,
  district: { select: { name: true } }, departmentHead: { select: { name: true } }, department: { select: { name: true } },
  subProject: { select: { name: true } }, designation: { select: { name: true } },
} as const;

/** GET /api/reports/export?kind=district&districtId=…  — same filters as the Reports page. */
export async function GET(request: Request) {
  const { user, error } = await authorizeApi("reports:export");
  if (error) return error;
  if (!rateLimit(`export:${user.id}`, 20, 10 * 60_000).ok) return Response.json({ error: "Too many exports. Please wait." }, { status: 429 });

  const sp = new URL(request.url).searchParams;
  const kind = sp.get("kind");
  if (!isReportKind(kind)) return Response.json({ error: "Unknown report kind" }, { status: 400 });
  const parsed = candidateFilterSchema.safeParse(Object.fromEntries(sp));
  if (!parsed.success) return Response.json({ error: "Invalid filters" }, { status: 400 });
  const { page: _p, pageSize: _s, ...filters } = parsed.data;

  const where = buildCandidateWhere(filters, user.districtScopeIds);
  const [groups, rows, names] = await Promise.all([
    groupCandidates(where, kind),
    prisma.candidate.findMany({ where, select: ROW_SELECT, orderBy: [{ fullName: "asc" }], take: 50_000 }),
    describeFilterIds(filters),
  ]);

  const title = `${REPORT_KINDS[kind].label} report`;
  const file = await buildCandidatesWorkbook({ title, filters: names, rows: rows.map(projectRow), groups, generatedBy: user.name ?? user.email });

  const run = await prisma.reportRun.create({ data: { userId: user.id, kind, filters, rowCount: rows.length, groups: groups.length } });
  await audit("EXPORT", { userId: user.id, target: run.id, metadata: { kind, rows: rows.length } });

  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${kind}_report_${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Human-readable filter description for the workbook summary (ids → names). */
async function describeFilterIds(f: Record<string, string | undefined>): Promise<string> {
  const parts: string[] = [];
  const name = async (model: "district" | "departmentHead" | "department" | "subProject" | "designation", id?: string) => {
    if (!id) return null;
    const d = prisma[model] as unknown as { findUnique(a: object): Promise<{ name: string } | null> };
    return (await d.findUnique({ where: { id } }))?.name ?? null;
  };
  const [dist, proj, dept, sub, des] = await Promise.all([
    name("district", f.districtId), name("departmentHead", f.departmentHeadId), name("department", f.departmentId), name("subProject", f.subProjectId), name("designation", f.designationId),
  ]);
  if (dist) parts.push(`District: ${dist}`);
  if (proj) parts.push(`Project: ${proj}`);
  if (dept) parts.push(`Department: ${dept}`);
  if (sub) parts.push(`Sub-project: ${sub}`);
  if (des) parts.push(`Designation: ${des}`);
  if (f.employeeType) parts.push(`Type: ${f.employeeType}`);
  if (f.gender) parts.push(`Gender: ${f.gender}`);
  if (f.educationType) parts.push(`Education: ${f.educationType}`);
  if (f.q) parts.push(`Search: ${f.q}`);
  return parts.length ? parts.join(" · ") : "All records";
}
