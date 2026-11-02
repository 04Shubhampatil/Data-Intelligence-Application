import "server-only";
import { signDocumentUrl } from "@/server/documents/signing";
import { prisma, type Prisma } from "@di/db";
import type { CandidateFilters } from "@/lib/validation/candidates";
import type { CurrentUser } from "@/server/auth/session";
import { hasPermission } from "@/lib/rbac";

/** Builds the WHERE clause. Always applies the user's district scope. Exported for tests. */
export function buildCandidateWhere(f: Omit<CandidateFilters, "page" | "pageSize">, scope: string[]): Prisma.CandidateWhereInput {
  const and: Prisma.CandidateWhereInput[] = [{ isDeletedAtSource: false }];

  if (scope.length) and.push({ districtId: { in: scope } });
  if (f.districtId) and.push({ districtId: f.districtId });
  if (f.departmentHeadId) and.push({ departmentHeadId: f.departmentHeadId });
  if (f.departmentId) and.push({ departmentId: f.departmentId });
  if (f.subProjectId) and.push({ subProjectId: f.subProjectId });
  if (f.designationId) and.push({ designationId: f.designationId });
  if (f.employeeType) and.push({ employeeType: f.employeeType });
  if (f.gender) and.push({ gender: f.gender });
  if (f.educationType) and.push({ educationType: f.educationType });
  if (f.reviewStatus === "AWAITING_CONFIRMATION") and.push({ reviewPendingConfirmation: true });
  else if (f.reviewStatus) and.push({ reviewStatus: f.reviewStatus });
  if (f.q) {
    and.push({
      OR: [
        { fullName: { contains: f.q } },
        { sourceEmployeeCode: { equals: f.q.toUpperCase() } },
        { officialEmployeeId: { equals: f.q.replace(/\s+/g, "").toUpperCase() } },
      ],
    });
  }
  return { AND: and };
}

const listSelect = {
  id: true,
  sourceEmployeeCode: true,
  fullName: true,
  gender: true,
  employeeType: true,
  taluka: true,
  lastSyncedAt: true,
  reviewStatus: true,
  reviewUpdated: true,
  reviewPendingConfirmation: true,
  district: { select: { name: true } },
  departmentHead: { select: { name: true } },
  subProject: { select: { name: true } },
  designation: { select: { name: true } },
} satisfies Prisma.CandidateSelect;

export type CandidateListItem = Prisma.CandidateGetPayload<{ select: typeof listSelect }>;

export async function listCandidates(filters: CandidateFilters, user: CurrentUser) {
  const where = buildCandidateWhere(filters, user.districtScopeIds);
  const [total, rows] = await prisma.$transaction([
    prisma.candidate.count({ where }),
    prisma.candidate.findMany({
      where,
      select: listSelect,
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ]);
  const photos = await profilePhotoUrls(rows.map((r) => r.id), user);
  return {
    total,
    rows: rows.map((r) => ({ ...r, photoUrl: photos.get(r.id) ?? null })),
    page: filters.page,
    pageSize: filters.pageSize,
    pageCount: Math.max(1, Math.ceil(total / filters.pageSize)),
  };
}

/**
 * Signed, user-bound, short-lived links to the stored profile photos of the given candidates
 * (one query per page). Only for users with documents:read; the ids come from an already
 * scope-filtered list, and the photo route re-checks permission and district on every request.
 */
export async function profilePhotoUrls(candidateIds: string[], user: CurrentUser): Promise<Map<string, string>> {
  if (!candidateIds.length || !hasPermission(user.permissions, "documents:read")) return new Map();
  const docs = await prisma.candidateDocument.findMany({
    where: { candidateId: { in: candidateIds }, kind: "PROFILE_PHOTO", slot: 0, status: "STORED", storageKey: { not: null } },
    select: { id: true, candidateId: true },
  });
  return new Map(docs.map((d) => [d.candidateId, signDocumentUrl(d.id, user.id, { inline: true })]));
}

export async function getCandidate(id: string, user: CurrentUser) {
  const where = buildCandidateWhere({}, user.districtScopeIds);
  const canSeeContact = hasPermission(user.permissions, "candidates:read_contact");
  return prisma.candidate.findFirst({
    where: { AND: [where, { id }] },
    include: {
      district: true,
      departmentHead: true,
      department: true,
      subProject: true,
      designation: true,
      sourceConnection: { select: { name: true, baseUrl: true } },
      profile: canSeeContact ? { select: { mobile: true, officialEmail: true } } : false,
    },
  });
}
