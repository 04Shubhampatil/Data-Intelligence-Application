import "server-only";
import { prisma, type Prisma } from "@di/db";
import type { AiFilters } from "./schemas";

export class FilterResolutionError extends Error {
  constructor(
    public field: string,
    public value: string,
    public suggestions: string[],
  ) {
    super(`No ${field} matches "${value}"${suggestions.length ? `. Did you mean: ${suggestions.join(", ")}?` : "."}`);
  }
}

type Lookup = "district" | "departmentHead" | "department" | "subProject" | "designation";

/** Exact (case-insensitive) match first, then a unique "contains" match, else an error with suggestions. */
async function resolveName(model: Lookup, value: string): Promise<string> {
  const delegate = prisma[model] as unknown as { findMany(a: object): Promise<{ id: string; name: string }[]> };
  const upper = value.toUpperCase();
  const exact = await delegate.findMany({ where: { name: upper }, take: 1 });
  if (exact[0]) return exact[0].id;
  const partial = await delegate.findMany({ where: { name: { contains: upper } }, take: 8, orderBy: { name: "asc" } });
  if (partial.length === 1) return partial[0].id;
  // Common abbreviations: match initials, e.g. "PMAY" → "PRADHAN MANTRI AWAS YOJANA".
  if (!partial.length && /^[A-Z]{2,8}$/.test(upper)) {
    const all = await delegate.findMany({ take: 500, orderBy: { name: "asc" } });
    const byInitials = all.filter((r) => r.name.split(/[\s\-/]+/).map((w) => w[0]).join("").includes(upper));
    if (byInitials.length === 1) return byInitials[0].id;
    throw new FilterResolutionError(model, value, byInitials.map((r) => r.name).slice(0, 8));
  }
  throw new FilterResolutionError(model, value, partial.map((r) => r.name));
}

/**
 * Users rarely distinguish "Department/Project" from "Department" (e.g. PMAY is a Department,
 * PMGSY a Department/Project). Resolve against the asked field first, then the other one.
 */
async function resolveProjectOrDepartment(value: string, prefer: "departmentHead" | "department"): Promise<Prisma.CandidateWhereInput> {
  const other = prefer === "departmentHead" ? "department" : "departmentHead";
  try {
    const id = await resolveName(prefer, value);
    return prefer === "departmentHead" ? { departmentHeadId: id } : { departmentId: id };
  } catch (first) {
    try {
      const id = await resolveName(other, value);
      return other === "departmentHead" ? { departmentHeadId: id } : { departmentId: id };
    } catch (second) {
      const a = first instanceof FilterResolutionError ? first.suggestions : [];
      const b = second instanceof FilterResolutionError ? second.suggestions : [];
      throw new FilterResolutionError("project or department", value, [...new Set([...a, ...b])].slice(0, 10));
    }
  }
}

/** Start / end of a calendar day in India time (review dates are asked in local terms). */
export const istDayStart = (d: string) => new Date(`${d}T00:00:00.000+05:30`);
export const istDayEnd = (d: string) => new Date(`${d}T23:59:59.999+05:30`);

/**
 * Reviewer by name or email — only among people who recorded decisions on candidates
 * the user can see, so the lookup never reveals reviewers from other districts.
 */
export async function resolveReviewer(value: string, scope: string[]): Promise<string> {
  const v = value.trim();
  const reviewers = await prisma.user.findMany({
    where: {
      reviews: { some: { candidate: scope.length ? { districtId: { in: scope } } : {} } },
      OR: [{ name: { contains: v } }, { email: { contains: v } }],
    },
    select: { id: true, name: true, email: true },
    take: 8,
    orderBy: { name: "asc" },
  });
  const exact = reviewers.filter((r) => r.name?.toLowerCase() === v.toLowerCase() || r.email.toLowerCase() === v.toLowerCase());
  if (exact.length === 1) return exact[0].id;
  if (reviewers.length === 1) return reviewers[0].id;
  throw new FilterResolutionError("reviewer", value, reviewers.map((r) => r.name ?? r.email));
}

/** Turns name-based AI filters into a Prisma where-clause. Scope (district ids) is always ANDed in. */
export async function filtersToWhere(f: AiFilters, scope: string[]): Promise<Prisma.CandidateWhereInput> {
  const and: Prisma.CandidateWhereInput[] = [{ isDeletedAtSource: false }];
  if (scope.length) and.push({ districtId: { in: scope } });
  if (f.district) and.push({ districtId: await resolveName("district", f.district) });
  if (f.project) and.push(await resolveProjectOrDepartment(f.project, "departmentHead"));
  if (f.department) and.push(await resolveProjectOrDepartment(f.department, "department"));
  if (f.subProject) and.push({ subProjectId: await resolveName("subProject", f.subProject) });
  if (f.designation) and.push({ designationId: await resolveName("designation", f.designation) });
  if (f.employeeType) and.push({ employeeType: { contains: f.employeeType } });
  if (f.gender) and.push({ gender: f.gender });
  if (f.educationType) and.push({ educationType: { contains: f.educationType } });
  if (f.nameContains) and.push({ fullName: { contains: f.nameContains } });
  if (f.reviewStatus === "AWAITING_CONFIRMATION") and.push({ reviewPendingConfirmation: true });
  else if (f.reviewStatus) and.push({ reviewStatus: f.reviewStatus });
  if (f.reviewedFrom || f.reviewedTo) {
    and.push({ reviewedAt: { ...(f.reviewedFrom ? { gte: istDayStart(f.reviewedFrom) } : {}), ...(f.reviewedTo ? { lte: istDayEnd(f.reviewedTo) } : {}) } });
  }
  if (f.reviewedBy) and.push({ reviews: { some: { reviewedById: await resolveReviewer(f.reviewedBy, scope) } } });
  return { AND: and };
}

const LABELS: Record<string, string> = { nameContains: "name", reviewStatus: "review", reviewedBy: "reviewed by", reviewedFrom: "reviewed from", reviewedTo: "reviewed to" };

export function describeFilters(f: AiFilters): string {
  const parts = Object.entries(f)
    .filter(([, v]) => v)
    .map(([k, v]) => `${LABELS[k] ?? k}: ${k === "reviewStatus" ? String(v).replace("_", " ").toLowerCase() : v}`);
  return parts.length ? parts.join(" · ") : "All records";
}
