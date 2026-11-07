import "server-only";
import { z } from "zod";
import { prisma, type Prisma } from "@di/db";
import type { CurrentUser } from "@/server/auth/session";
import { candidateScope, isScoped } from "@/server/auth/scope";
import { buildCandidateWhere, profilePhotoUrls } from "./candidate.service";

const id = z.string().trim().max(40).regex(/^[a-z0-9]+$/i);
const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === "" || v === "all" ? undefined : v), s.optional());
const date = opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));

/** Filters for the District Admin review table. */
export const reviewTableFilterSchema = z.object({
  districtId: opt(id),
  departmentHeadId: opt(id),
  departmentId: opt(id),
  designationId: opt(id),
  reviewStatus: opt(z.enum(["PENDING_REVIEW", "SELECTED", "REJECTED", "AWAITING_CONFIRMATION"])),
  reviewerId: opt(id),
  from: date,
  to: date,
  q: opt(z.string().trim().max(80)),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
});
export type ReviewTableFilters = z.infer<typeof reviewTableFilterSchema>;

export function parseReviewFilters(sp: Record<string, string | string[] | undefined>): ReviewTableFilters {
  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const parsed = reviewTableFilterSchema.safeParse(flat);
  return parsed.success ? parsed.data : reviewTableFilterSchema.parse({});
}

function reviewWhere(f: ReviewTableFilters, user: CurrentUser): Prisma.CandidateWhereInput {
  const base = buildCandidateWhere(
    { districtId: f.districtId, departmentHeadId: f.departmentHeadId, departmentId: f.departmentId, designationId: f.designationId, reviewStatus: f.reviewStatus, q: f.q },
    user.districtScopeIds,
  );
  const and = [...((base.AND as Prisma.CandidateWhereInput[]) ?? [])];
  if (f.reviewerId || f.from || f.to) {
    // Filter on the candidate's latest decision.
    const reviewedAt: Prisma.DateTimeNullableFilter = {};
    if (f.from) reviewedAt.gte = new Date(`${f.from}T00:00:00.000+05:30`);
    if (f.to) reviewedAt.lte = new Date(`${f.to}T23:59:59.999+05:30`);
    if (f.from || f.to) and.push({ reviewedAt });
    if (f.reviewerId) and.push({ reviews: { some: { reviewedById: f.reviewerId } } });
  }
  return { AND: and };
}

/** Counts shown on both district dashboards; always under the user's scope. */
export async function getDistrictCounts(user: CurrentUser, extra: Prisma.CandidateWhereInput = {}) {
  const where: Prisma.CandidateWhereInput = { isDeletedAtSource: false, ...candidateScope(user), ...extra };
  const [total, pending, selected, rejected, awaiting] = await Promise.all([
    prisma.candidate.count({ where }),
    prisma.candidate.count({ where: { ...where, reviewStatus: "PENDING_REVIEW" } }),
    prisma.candidate.count({ where: { ...where, reviewStatus: "SELECTED" } }),
    prisma.candidate.count({ where: { ...where, reviewStatus: "REJECTED" } }),
    prisma.candidate.count({ where: { ...where, reviewPendingConfirmation: true } }),
  ]);
  return { total, pending, selected, rejected, awaiting };
}

/** District Viewers assigned to any of the user's districts (for the District Admin dashboard). */
export async function getDistrictViewers(user: CurrentUser) {
  return prisma.user.findMany({
    where: {
      isActive: true,
      role: { name: "DISTRICT_VIEWER" },
      ...(isScoped(user) ? { districtAssignments: { some: { districtId: { in: user.districtScopeIds } } } } : {}),
    },
    select: { id: true, name: true, username: true, lastLoginAt: true, districtAssignments: { select: { district: { select: { name: true } } } } },
    orderBy: { name: "asc" },
  });
}

/** Users who have reviewed candidates in scope (reviewer filter options). */
export async function getReviewerOptions(user: CurrentUser) {
  const rows = await prisma.candidateReview.findMany({
    where: { candidate: { ...candidateScope(user) } },
    distinct: ["reviewedById"],
    select: { reviewedBy: { select: { id: true, name: true, username: true } } },
    take: 200,
  });
  return rows.map((r) => ({ value: r.reviewedBy.id, label: r.reviewedBy.name ?? r.reviewedBy.username })).sort((a, b) => a.label.localeCompare(b.label));
}

const PAGE = 25;

/** The District Admin review table: one row per candidate with its latest decision and comment count. */
export async function getReviewTable(f: ReviewTableFilters, user: CurrentUser) {
  const where = reviewWhere(f, user);
  const [total, rows] = await Promise.all([
    prisma.candidate.count({ where }),
    prisma.candidate.findMany({
      where,
      orderBy: [{ reviewedAt: { sort: "desc", nulls: "last" } }, { fullName: "asc" }],
      skip: (f.page - 1) * PAGE,
      take: PAGE,
      select: {
        id: true, sourceEmployeeCode: true, fullName: true, reviewStatus: true, reviewUpdated: true, reviewPendingConfirmation: true, reviewedAt: true,
        district: { select: { name: true } },
        designation: { select: { name: true } },
        departmentHead: { select: { name: true } },
        reviews: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, remark: true, decision: true, requiresConfirmation: true, confirmedAt: true, reviewedBy: { select: { name: true, username: true } } } },
        _count: { select: { comments: true } },
      },
    }),
  ]);
  const photos = await profilePhotoUrls(rows.map((r) => r.id), user);
  return { total, rows: rows.map((r) => ({ ...r, photoUrl: photos.get(r.id) ?? null })), page: f.page, pageSize: PAGE, pageCount: Math.max(1, Math.ceil(total / PAGE)) };
}

/** Latest decisions and comments across the scope (activity feed). */
export async function getRecentReviewActivity(user: CurrentUser, take = 10) {
  const scope = candidateScope(user);
  const [reviews, comments] = await Promise.all([
    prisma.candidateReview.findMany({
      where: { candidate: scope },
      orderBy: { createdAt: "desc" },
      take,
      select: { id: true, decision: true, isOverride: true, requiresConfirmation: true, confirmedAt: true, createdAt: true, candidate: { select: { id: true, fullName: true, sourceEmployeeCode: true } }, reviewedBy: { select: { name: true, username: true } } },
    }),
    prisma.candidateComment.findMany({
      where: { candidate: scope },
      orderBy: { createdAt: "desc" },
      take,
      select: { id: true, body: true, createdAt: true, candidate: { select: { id: true, fullName: true } }, author: { select: { name: true, username: true } } },
    }),
  ]);
  return [...reviews.map((r) => ({ kind: "review" as const, at: r.createdAt, r })), ...comments.map((c) => ({ kind: "comment" as const, at: c.createdAt, c }))]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, take);
}

/** Candidate list for the District Viewer dashboard (their single district). */
export async function getViewerQueue(user: CurrentUser, status: "PENDING_REVIEW" | "SELECTED" | "REJECTED" | "ALL", page: number, q?: string) {
  const where: Prisma.CandidateWhereInput = {
    isDeletedAtSource: false,
    ...candidateScope(user),
    ...(status === "ALL" ? {} : { reviewStatus: status }),
    ...(q ? { OR: [{ fullName: { contains: q } }, { sourceEmployeeCode: { equals: q.toUpperCase() } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.candidate.count({ where }),
    prisma.candidate.findMany({
      where,
      orderBy: [{ reviewStatus: "asc" }, { fullName: "asc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      select: {
        id: true, sourceEmployeeCode: true, fullName: true, reviewStatus: true, reviewUpdated: true, reviewPendingConfirmation: true, reviewedAt: true,
        designation: { select: { name: true } }, departmentHead: { select: { name: true } }, taluka: true,
        _count: { select: { documents: { where: { status: "STORED" } }, comments: true } },
      },
    }),
  ]);
  const photos = await profilePhotoUrls(rows.map((r) => r.id), user);
  return { total, rows: rows.map((r) => ({ ...r, photoUrl: photos.get(r.id) ?? null })), page, pageSize: PAGE, pageCount: Math.max(1, Math.ceil(total / PAGE)) };
}

const VERIFIED_PAGE = 10;

/**
 * Verified Records on the District Dashboard: only candidates whose current decision is
 * Verified (stored as SELECTED) and no longer waiting for confirmation, inside the user's districts.
 */
export async function getVerifiedRecords(user: CurrentUser, opts: { page?: number; q?: string } = {}) {
  const page = Math.max(1, Math.floor(opts.page ?? 1) || 1);
  const q = opts.q?.trim().slice(0, 80) || undefined;
  const where: Prisma.CandidateWhereInput = {
    isDeletedAtSource: false,
    ...candidateScope(user),
    reviewStatus: "SELECTED",
    reviewPendingConfirmation: false,
    ...(q
      ? { OR: [{ fullName: { contains: q } }, { sourceEmployeeCode: { equals: q.toUpperCase() } }, { officialEmployeeId: { equals: q.replace(/\s+/g, "").toUpperCase() } }] }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.candidate.count({ where }),
    prisma.candidate.findMany({
      where,
      orderBy: [{ reviewedAt: { sort: "desc", nulls: "last" } }, { fullName: "asc" }],
      skip: (page - 1) * VERIFIED_PAGE,
      take: VERIFIED_PAGE,
      select: {
        id: true, sourceEmployeeCode: true, officialEmployeeId: true, fullName: true, reviewedAt: true,
        district: { select: { name: true } },
        designation: { select: { name: true } },
        departmentHead: { select: { name: true } },
        reviews: { where: { decision: "SELECTED" }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true, reviewedBy: { select: { name: true, username: true } } } },
      },
    }),
  ]);
  const photos = await profilePhotoUrls(rows.map((r) => r.id), user);
  return {
    total,
    q: q ?? "",
    rows: rows.map(({ reviews, ...r }) => ({
      ...r,
      photoUrl: photos.get(r.id) ?? null,
      verifiedBy: reviews[0] ? (reviews[0].reviewedBy.name ?? reviews[0].reviewedBy.username) : null,
      verifiedAt: r.reviewedAt ?? reviews[0]?.createdAt ?? null,
    })),
    page,
    pageSize: VERIFIED_PAGE,
    pageCount: Math.max(1, Math.ceil(total / VERIFIED_PAGE)),
  };
}
