import "server-only";
import { prisma, type Prisma } from "@di/db";
import type { CurrentUser } from "@/server/auth/session";
import type { CandidateFilters } from "@/lib/validation/candidates";
import { buildCandidateWhere } from "./candidate.service";

/** Breakdowns the Reports page, the dashboard and the AI tools can produce. */
export const REPORT_KINDS = {
  district: { label: "District-wise", column: "districtId", lookup: "district" },
  project: { label: "Project-wise (Department/Project)", column: "departmentHeadId", lookup: "departmentHead" },
  department: { label: "Department-wise", column: "departmentId", lookup: "department" },
  subProject: { label: "Sub-project-wise", column: "subProjectId", lookup: "subProject" },
  designation: { label: "Designation-wise", column: "designationId", lookup: "designation" },
  employeeType: { label: "Type of employee", column: "employeeType", lookup: null },
  gender: { label: "Gender", column: "gender", lookup: null },
  docVerificationStatus: { label: "Document verification", column: "docVerificationStatus", lookup: null },
  sourceStatus: { label: "Status at source", column: "sourceStatus", lookup: null },
  reviewStatus: { label: "Review status", column: "reviewStatus", lookup: null },
} as const;

export type ReportKind = keyof typeof REPORT_KINDS;
export const REPORT_KIND_KEYS = Object.keys(REPORT_KINDS) as ReportKind[];
export const isReportKind = (v: unknown): v is ReportKind => typeof v === "string" && v in REPORT_KINDS;

export type GroupRow = { label: string; count: number; share: number };

/**
 * Counts candidates per value of `kind` under an arbitrary where-clause.
 * Lookup columns are resolved to names; null becomes "Unassigned".
 */
export async function groupCandidates(where: Prisma.CandidateWhereInput, kind: ReportKind, take = 200): Promise<GroupRow[]> {
  const { column, lookup } = REPORT_KINDS[kind];
  // Prisma's groupBy is typed per literal column; a dynamic column needs an untyped call.
  const client = prisma.candidate as unknown as { groupBy(args: object): Promise<Record<string, unknown>[]> };
  const groups = await client.groupBy({ by: [column], where, _count: { _all: true }, orderBy: { _count: { id: "desc" } }, take });
  const raw = groups.map((g) => ({ key: (g[column] as string | null) ?? null, count: (g._count as { _all: number })._all }));

  let nameOf = new Map<string, string>();
  if (lookup) {
    const ids = raw.map((r) => r.key).filter((v): v is string => !!v);
    const delegate = prisma[lookup] as unknown as { findMany(a: object): Promise<{ id: string; name: string }[]> };
    nameOf = new Map((await delegate.findMany({ where: { id: { in: ids } } })).map((r) => [r.id, r.name]));
  }
  if (kind === "reviewStatus") nameOf = new Map([["PENDING_REVIEW", "Pending review"], ["SELECTED", "Verified"], ["REJECTED", "Rejected"]]);
  const total = raw.reduce((s, r) => s + r.count, 0) || 1;
  return raw.map((r) => ({
    label: r.key ? (nameOf.get(r.key) ?? r.key) : "Unassigned",
    count: r.count,
    share: r.count / total,
  }));
}

/** A full report for the Reports page: total + breakdown, under the user's scope and the page filters. */
export async function getReport(kind: ReportKind, filters: Omit<CandidateFilters, "page" | "pageSize">, user: CurrentUser) {
  const where = buildCandidateWhere(filters, user.districtScopeIds);
  const [total, groups] = await Promise.all([prisma.candidate.count({ where }), groupCandidates(where, kind)]);
  return { kind, label: REPORT_KINDS[kind].label, total, groups };
}

export async function listRecentReports(user: CurrentUser, take = 10) {
  return prisma.reportRun.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, kind: true, filters: true, rowCount: true, groups: true, createdAt: true },
  });
}
