import "server-only";
import { z } from "zod";
import { prisma, type Prisma } from "@di/db";
import type { CurrentUser } from "@/server/auth/session";
import { candidateScope } from "@/server/auth/scope";
import { hasPermission } from "@/lib/rbac";
import { groupCandidates } from "./report.service";
import { profilePhotoUrls } from "./candidate.service";

const TZ = "Asia/Kolkata";
const MONTHS = 6;

/** "YYYY-MM" of a date in India time. */
const monthKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(d).slice(0, 7);

/** The last `n` month keys ending with the current one (India time), oldest first. */
export function lastMonths(n: number, now = new Date()): string[] {
  const [y, m] = monthKey(now).split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/** Cumulative count of dates up to the end of each month key. */
export function cumulativeByMonth(dates: Date[], months: string[]): number[] {
  const keys = dates.map(monthKey).sort();
  let i = 0;
  return months.map((m) => {
    while (i < keys.length && keys[i] <= m) i++;
    return i;
  });
}

/** Count of dates falling in each month key. */
export function countByMonth(dates: Date[], months: string[]): number[] {
  const counts = new Map<string, number>();
  for (const d of dates) counts.set(monthKey(d), (counts.get(monthKey(d)) ?? 0) + 1);
  return months.map((m) => counts.get(m) ?? 0);
}

/** % change between two values; null when there is no meaningful base. */
export function trendPct(now: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}

export const overviewFilterSchema = z.object({
  district: z.preprocess((v) => (v === "" || v === "all" ? undefined : v), z.string().regex(/^[a-z0-9]{1,40}$/i).optional()),
  status: z.preprocess((v) => (v === "" || v === "all" ? undefined : v), z.enum(["PENDING_REVIEW", "SELECTED", "REJECTED"]).optional()),
});
export type OverviewFilters = z.infer<typeof overviewFilterSchema>;

/**
 * Everything the main dashboard shows, under the user's district scope.
 * Trends compare today's value with the value 30 days ago; series are cumulative by month
 * (a candidate's current review status is dated by its latest decision).
 */
export async function getOverview(user: CurrentUser, filters: OverviewFilters = {}, now = new Date()) {
  const scope: Prisma.CandidateWhereInput = { isDeletedAtSource: false, ...candidateScope(user) };
  const months = lastMonths(MONTHS, now);
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
  const firstMonthStart = new Date(`${months[0]}-01T00:00:00+05:30`);

  const [created, decided, pending, selected, rejected, districts, decisionsInWindow, syncedInWindow] = await Promise.all([
    prisma.candidate.findMany({ where: scope, select: { createdAt: true } }),
    prisma.candidate.findMany({ where: { ...scope, reviewStatus: { in: ["SELECTED", "REJECTED"] } }, select: { reviewStatus: true, reviewedAt: true, createdAt: true } }),
    prisma.candidate.count({ where: { ...scope, reviewStatus: "PENDING_REVIEW" } }),
    prisma.candidate.count({ where: { ...scope, reviewStatus: "SELECTED" } }),
    prisma.candidate.count({ where: { ...scope, reviewStatus: "REJECTED" } }),
    groupCandidates(scope, "district", 200),
    prisma.candidateReview.findMany({ where: { createdAt: { gte: firstMonthStart }, candidate: scope }, select: { decision: true, createdAt: true } }),
    prisma.candidate.findMany({ where: { ...scope, createdAt: { gte: firstMonthStart } }, select: { createdAt: true } }),
  ]);

  const total = created.length;
  const decidedAt = (s: string) => decided.filter((d) => d.reviewStatus === s).map((d) => d.reviewedAt ?? d.createdAt);
  const totalSeries = cumulativeByMonth(created.map((c) => c.createdAt), months);
  const selectedSeries = cumulativeByMonth(decidedAt("SELECTED"), months);
  const rejectedSeries = cumulativeByMonth(decidedAt("REJECTED"), months);
  const pendingSeries = totalSeries.map((t, i) => Math.max(0, t - selectedSeries[i] - rejectedSeries[i]));

  const before = (dates: Date[]) => dates.filter((d) => d <= monthAgo).length;
  const totalBefore = before(created.map((c) => c.createdAt));
  const selBefore = before(decidedAt("SELECTED"));
  const rejBefore = before(decidedAt("REJECTED"));

  const top = districts.filter((d) => d.label !== "Unassigned");
  const otherCount = districts.reduce((s, d) => s + d.count, 0) - top.slice(0, 3).reduce((s, d) => s + d.count, 0);

  return {
    stats: {
      total: { value: total, trend: trendPct(total, totalBefore), series: totalSeries },
      pending: { value: pending, trend: trendPct(pending, Math.max(0, totalBefore - selBefore - rejBefore)), series: pendingSeries },
      selected: { value: selected, trend: trendPct(selected, selBefore), series: selectedSeries },
      rejected: { value: rejected, trend: trendPct(rejected, rejBefore), series: rejectedSeries },
    },
    districtOverview: { top3: top.slice(0, 3), other: otherCount, total },
    topDistricts: top.slice(0, 5),
    monthly: monthlyActivity(months, syncedInWindow.map((c) => c.createdAt), decisionsInWindow),
    reviewTable: await reviewTable(user, scope, filters),
  };
}

/** Per month: candidates synced, and selection / rejection decisions recorded. */
export function monthlyActivity(months: string[], synced: Date[], decisions: { decision: string; createdAt: Date }[]) {
  const s = countByMonth(synced, months);
  const sel = countByMonth(decisions.filter((d) => d.decision === "SELECTED").map((d) => d.createdAt), months);
  const rej = countByMonth(decisions.filter((d) => d.decision === "REJECTED").map((d) => d.createdAt), months);
  return months.map((month, i) => ({ month, synced: s[i], selected: sel[i], rejected: rej[i] }));
}

/** Latest candidates for the review table: decided ones first (newest decision), then pending. */
async function reviewTable(user: CurrentUser, scope: Prisma.CandidateWhereInput, f: OverviewFilters) {
  const where: Prisma.CandidateWhereInput = {
    ...scope,
    ...(f.status ? { reviewStatus: f.status } : {}),
    ...(f.district ? { AND: [{ districtId: f.district }, candidateScope(user)] } : {}),
  };
  const rows = await prisma.candidate.findMany({
    where,
    orderBy: [{ reviewedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
    take: 5,
    select: {
      id: true, fullName: true, sourceEmployeeCode: true, officialEmployeeId: true, reviewStatus: true, reviewUpdated: true, reviewPendingConfirmation: true, reviewedAt: true,
      district: { select: { name: true } },
      designation: { select: { name: true } },
      reviews: { orderBy: { createdAt: "desc" }, take: 1, select: { reviewedBy: { select: { name: true, username: true } } } },
    },
  });
  const photos = await profilePhotoUrls(rows.map((r) => r.id), user);
  const districtOptions = hasPermission(user.permissions, "candidates:read")
    ? await prisma.district.findMany({ where: user.districtScopeIds.length ? { id: { in: user.districtScopeIds } } : {}, orderBy: { name: "asc" }, select: { id: true, name: true } })
    : [];
  return { rows: rows.map((r) => ({ ...r, photoUrl: photos.get(r.id) ?? null })), districtOptions };
}
