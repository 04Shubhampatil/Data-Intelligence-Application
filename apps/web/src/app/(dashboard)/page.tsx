import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowDown, ArrowRight, ArrowUp, BarChart3, CalendarDays, CheckCircle2, Clock, Eye, FileBarChart, MapPinned, Megaphone,
  PieChart, RefreshCw, Trophy, UserCog, Users, XCircle, Zap, type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CandidateAvatar } from "@/components/candidate-avatar";
import { ReviewStatusBadge } from "@/components/review-status-badge";
import { Sparkline } from "@/components/dashboard/sparkline";
import { StatusDonut } from "@/components/dashboard/status-donut";
import { ActivityChart } from "@/components/dashboard/activity-chart";
import { ReviewTableFilters } from "@/components/dashboard/review-table-filters";
import { HeroIllustration } from "@/components/dashboard/hero-illustration";
import { requireUser } from "@/server/auth/session";
import { getOverview, overviewFilterSchema } from "@/server/services/overview.service";
import { getDashboardData } from "@/server/services/dashboard.service";
import { listThreads } from "@/server/services/message.service";
import { formatDateTime, formatNumber, relativeTime } from "@/lib/format";
import { hasPermission, homeFor } from "@/lib/rbac";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

/* Chart colours: validated for colour-vision deficiency (see globals.css). */
const C = { total: "#1E40AF", pending: "#2563EB", selected: "#0E7C3A", rejected: "#F28B82" };

function Trend({ pct, goodWhenUp = true }: { pct: number | null; goodWhenUp?: boolean }) {
  if (pct === null) return <span className="text-xs text-muted-foreground">No earlier data</span>;
  const up = pct > 0;
  const flat = pct === 0;
  const good = flat ? null : up === goodWhenUp;
  const Icon = flat ? ArrowRight : up ? ArrowUp : ArrowDown;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", good === null ? "text-muted-foreground" : good ? "text-success" : "text-destructive")}>
      <Icon className="size-3.5" aria-hidden />
      {flat ? "0%" : `${up ? "+" : ""}${pct}%`}
      <span className="sr-only">compared with 30 days ago</span>
    </span>
  );
}

function StatCard({ label, value, icon: Icon, tint, color, trend, series, months, goodWhenUp }: {
  label: string; value: number; icon: LucideIcon; tint: string; color: string; trend: number | null; series: number[]; months: string[]; goodWhenUp?: boolean;
}) {
  return (
    <Card className="gap-0 py-5">
      <CardContent className="px-5">
        <div className={cn("grid size-11 place-items-center rounded-full", tint)}>
          <Icon className="size-5" />
        </div>
        <p className="mt-3 text-3xl font-bold tracking-tight tabular-nums text-foreground">{formatNumber(value)}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className="mt-2 flex items-end justify-between gap-2">
          <Trend pct={trend} goodWhenUp={goodWhenUp} />
          <Sparkline values={series} color={color} label={label} months={months} />
        </div>
      </CardContent>
    </Card>
  );
}

function SectionTitle({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
      <div>
        <CardTitle className="flex items-center gap-2 text-lg"><Icon className="size-5 text-primary" />{title}</CardTitle>
        {description && <CardDescription className="mt-1">{description}</CardDescription>}
      </div>
      {action}
    </CardHeader>
  );
}

const viewAll = (href: string) => (
  <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
    View All <ArrowRight className="size-3.5" />
  </Link>
);

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const user = await requireUser("dashboard:read");
  // District roles have their own dashboards (design §6); the global dashboard stays for global roles.
  const home = homeFor(user.role);
  if (home !== "/") redirect(home);

  const sp = await searchParams;
  const filters = overviewFilterSchema.parse({ district: sp.district, status: sp.status });
  const canMessages = hasPermission(user.permissions, "messages:read");
  const [o, legacy, threads] = await Promise.all([
    getOverview(user, filters),
    getDashboardData(user),
    canMessages ? listThreads(user, { take: 3 }) : Promise.resolve(null),
  ]);
  const months = o.monthly.map((m) => m.month);
  const total = o.stats.total.value;
  const today = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const displayName = user.name ?? user.email.split("@")[0];

  const quick = [
    hasPermission(user.permissions, "sync:run") && { href: "/sync", label: "Sync Data", icon: RefreshCw },
    hasPermission(user.permissions, "reports:read") && { href: "/reports", label: "Generate Report", icon: FileBarChart },
    hasPermission(user.permissions, "users:manage") && { href: "/settings", label: "Manage Users", icon: UserCog },
    hasPermission(user.permissions, "reports:read") && { href: "/reports?kind=district", label: "View Analytics", icon: PieChart },
  ].filter(Boolean) as { href: string; label: string; icon: LucideIcon }[];

  return (
    <div className="space-y-6">
      {/* Welcome banner */}
      <section className="relative overflow-hidden rounded-3xl bg-linear-to-r from-[#0b1f4d] via-[#123a8c] to-[#1d4ed8] px-6 py-7 text-white shadow-card sm:px-8">
        <div className="pointer-events-none absolute -right-10 -top-16 size-72 rounded-full bg-sky-400/20 blur-3xl" aria-hidden />
        <div className="relative flex items-center justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Welcome back, {displayName}!</h1>
            <p className="mt-1.5 text-sm text-white/80 sm:text-base">Here&apos;s your complete candidate overview for MAHAHRD</p>
            <p className="mt-4 inline-flex items-center gap-2 text-sm text-white/85"><CalendarDays className="size-4" /> {today}</p>
            {legacy.latestJob && (
              <p className="mt-1 text-xs text-white/60">
                Last sync {legacy.latestJob.status.toLowerCase()} · {formatDateTime(legacy.latestJob.finishedAt ?? legacy.latestJob.startedAt ?? legacy.latestJob.createdAt)}
              </p>
            )}
          </div>
          <div className="hidden h-32 shrink-0 md:block"><HeroIllustration /></div>
        </div>
      </section>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Candidates" value={total} icon={Users} tint="bg-blue-100 text-blue-700" color={C.total} trend={o.stats.total.trend} series={o.stats.total.series} months={months} />
        <StatCard label="Pending Review" value={o.stats.pending.value} icon={Eye} tint="bg-sky-100 text-sky-700" color={C.pending} trend={o.stats.pending.trend} series={o.stats.pending.series} months={months} goodWhenUp={false} />
        <StatCard label="Verified" value={o.stats.selected.value} icon={CheckCircle2} tint="bg-emerald-100 text-emerald-700" color={C.selected} trend={o.stats.selected.trend} series={o.stats.selected.series} months={months} />
        <StatCard label="Rejected" value={o.stats.rejected.value} icon={XCircle} tint="bg-rose-100 text-rose-700" color={C.rejected} trend={o.stats.rejected.trend} series={o.stats.rejected.series} months={months} goodWhenUp={false} />
      </div>

      {/* District overview + review status */}
      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <SectionTitle icon={MapPinned} title="District Overview" description="Candidate distribution across districts" action={viewAll("/reports?kind=district")} />
          <CardContent>
            {total === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No candidates synced yet.</p>
            ) : (
              <ul className="space-y-5" role="list">
                {[...o.districtOverview.top3.map((d) => ({ label: d.label, count: d.count })), { label: "Other districts", count: o.districtOverview.other }].map((d, i) => {
                  const share = total ? d.count / total : 0;
                  return (
                    <li key={d.label}>
                      <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                        <span className="flex items-center gap-2 font-medium text-foreground">
                          <span className={cn("size-2.5 rounded-full", i === 3 ? "bg-slate-300" : "bg-blue-600")} style={i < 3 ? { opacity: 1 - i * 0.25 } : undefined} aria-hidden />
                          {d.label}
                        </span>
                        <span className="tabular-nums text-muted-foreground"><span className="font-semibold text-foreground">{formatNumber(d.count)}</span> · {(share * 100).toFixed(1)}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted">
                        <div className={cn("h-2 rounded-full", i === 3 ? "bg-slate-300" : "bg-blue-600")} style={{ width: `${Math.max(1, share * 100)}%`, opacity: i < 3 ? 1 - i * 0.25 : undefined }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {legacy.unassignedDistrict > 0 && (
              <p className="mt-4 text-xs text-muted-foreground">{formatNumber(legacy.unassignedDistrict)} record(s) have no district at the source.</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-5">
          <SectionTitle icon={PieChart} title="Review Status" description="Current status breakdown" />
          <CardContent>
            <StatusDonut
              total={total}
              slices={[
                { label: "Pending", value: o.stats.pending.value, color: C.pending },
                { label: "Verified", value: o.stats.selected.value, color: C.selected },
                { label: "Rejected", value: o.stats.rejected.value, color: C.rejected },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      {/* Candidate review + messages / quick actions */}
      <div className="grid gap-6 xl:grid-cols-12">
        <Card className="overflow-hidden py-0 xl:col-span-8">
          <div className="pt-5">
            <SectionTitle icon={Users} title="Candidate Review" description="Latest decisions and candidates awaiting review" action={<ReviewTableFilters districts={o.reviewTable.districtOptions} />} />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-y bg-muted/70 text-left text-xs font-semibold text-foreground">
                  <th className="px-5 py-3">Photo</th>
                  <th className="px-3 py-3">Candidate Details</th>
                  <th className="px-3 py-3">District</th>
                  <th className="px-3 py-3">Designation</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Reviewed By</th>
                  <th className="px-3 py-3">Review Date</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {o.reviewTable.rows.length === 0 ? (
                  <tr><td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">No candidates match these filters.</td></tr>
                ) : (
                  o.reviewTable.rows.map((r) => {
                    const by = r.reviews[0]?.reviewedBy;
                    return (
                      <tr key={r.id} className="transition-colors hover:bg-accent/40">
                        <td className="px-5 py-3"><CandidateAvatar photoUrl={r.photoUrl} name={r.fullName} /></td>
                        <td className="px-3 py-3">
                          <p className="font-semibold text-foreground">{r.fullName}</p>
                          <p className="text-xs text-muted-foreground">{r.officialEmployeeId ?? r.sourceEmployeeCode}</p>
                        </td>
                        <td className="px-3 py-3 text-xs">{r.district?.name ?? "—"}</td>
                        <td className="max-w-44 px-3 py-3 text-xs">{r.designation?.name ?? "—"}</td>
                        <td className="px-3 py-3"><ReviewStatusBadge status={r.reviewStatus} updated={r.reviewUpdated} pendingConfirmation={r.reviewPendingConfirmation} /></td>
                        <td className="px-3 py-3 text-xs">{r.reviewStatus === "PENDING_REVIEW" || !by ? "—" : (by.name ?? by.email)}</td>
                        <td className="px-3 py-3 text-xs text-muted-foreground">{r.reviewedAt ? formatDateTime(r.reviewedAt) : "—"}</td>
                        <td className="px-5 py-3 text-right">
                          <Button size="sm" variant="secondary" asChild><Link href={`/candidates/${r.id}`}>View</Link></Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t px-5 py-3 text-right">{viewAll("/candidates")}</div>
        </Card>

        <div className="space-y-6 xl:col-span-4">
          {threads && (
            <Card>
              <SectionTitle icon={Megaphone} title="Recent Messages" action={viewAll("/messages")} />
              <CardContent>
                {threads.rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No messages yet.</p>
                ) : (
                  <ul className="divide-y" role="list">
                    {threads.rows.map((m) => (
                      <li key={m.id} className="py-3 first:pt-0 last:pb-0">
                        <Link href={`/messages/${m.id}`} className="group flex gap-3">
                          <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", m.unreadForMe ? "bg-primary" : "bg-border")} aria-hidden />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-foreground group-hover:underline">{m.subject}</span>
                            <span className="block text-xs text-muted-foreground">{m.district.name} · {relativeTime(m.createdAt)}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          {quick.length > 0 && (
            <Card>
              <SectionTitle icon={Zap} title="Quick Actions" />
              <CardContent className="grid grid-cols-2 gap-3">
                {quick.map((q) => (
                  <Link key={q.label} href={q.href} className="flex flex-col items-center gap-2 rounded-2xl border bg-accent/40 px-3 py-4 text-center text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-accent">
                    <q.icon className="size-5 text-primary" />
                    {q.label}
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* System analytics + top districts */}
      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <SectionTitle icon={BarChart3} title="System Analytics" description="Monthly candidate activity · last 6 months" />
          <CardContent>
            <ActivityChart data={o.monthly} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-5">
          <SectionTitle icon={Trophy} title="Top Districts" description="By total candidates" action={viewAll("/reports?kind=district")} />
          <CardContent>
            {o.topDistricts.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No districts yet.</p>
            ) : (
              <ol className="space-y-4" role="list">
                {o.topDistricts.map((d, i) => (
                  <li key={d.label} className="flex items-center gap-3 text-sm">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-accent-foreground">{i + 1}</span>
                    <span className="w-28 shrink-0 truncate font-medium text-foreground" title={d.label}>{d.label}</span>
                    <span className="h-2 flex-1 rounded-full bg-muted">
                      <span className="block h-2 rounded-full bg-blue-600" style={{ width: `${(d.count / o.topDistricts[0].count) * 100}%` }} />
                    </span>
                    <span className="w-14 text-right font-semibold tabular-nums text-foreground">{formatNumber(d.count)}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="size-3.5" /> Trends compare today with 30 days ago. Figures cover the districts you can access.</p>
    </div>
  );
}
