import "server-only";
import { prisma } from "@di/db";
import type { CurrentUser } from "@/server/auth/session";
import { hasPermission } from "@/lib/rbac";
import { buildCandidateWhere } from "./candidate.service";
import { groupCandidates } from "./report.service";

export async function getDashboardData(user: CurrentUser) {
  const where = buildCandidateWhere({}, user.districtScopeIds);
  const [totalCandidates, latestJob, recentActivity, byProject, byDistrict, unassignedDistrict] = await Promise.all([
    prisma.candidate.count({ where }),
    prisma.syncJob.findFirst({
      orderBy: { createdAt: "desc" },
      select: {
        id: true, status: true, mode: true, processed: true, created: true, updated: true,
        unchanged: true, failed: true, totalRecords: true, startedAt: true, finishedAt: true, createdAt: true,
      },
    }),
    prisma.auditLog.findMany({
      where: hasPermission(user.permissions, "audit:read") ? {} : { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, action: true, target: true, createdAt: true, user: { select: { name: true, username: true } } },
    }),
    groupCandidates(where, "project", 8),
    groupCandidates(where, "district", 8),
    // Records whose source district was blank/unknown: never guessed, visible to global users only.
    user.districtScopeIds.length ? Promise.resolve(0) : prisma.candidate.count({ where: { isDeletedAtSource: false, districtId: null } }),
  ]);

  return {
    totalCandidates,
    latestJob,
    successful: latestJob ? latestJob.created + latestJob.updated + latestJob.unchanged : 0,
    failed: latestJob?.failed ?? 0,
    byProject,
    byDistrict,
    recentActivity,
    unassignedDistrict,
  };
}
