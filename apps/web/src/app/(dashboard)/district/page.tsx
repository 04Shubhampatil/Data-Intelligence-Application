import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Clock, Eye, MessageSquare, ShieldCheck, Users, UsersRound, XCircle, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/pagination";
import { ReviewStatusBadge } from "@/components/review-status-badge";
import { EmptyState } from "@/components/empty-state";
import { requireUser } from "@/server/auth/session";
import { getFilterOptions } from "@/server/services/lookup.service";
import { getDistrictCounts, getDistrictViewers, getRecentReviewActivity, getReviewerOptions, getReviewTable, parseReviewFilters } from "@/server/services/district.service";
import { prisma } from "@di/db";
import { formatDateTime, formatNumber, relativeTime } from "@/lib/format";
import { DistrictFilters } from "./district-filters";
import { composeOptions, listThreads } from "@/server/services/message.service";
import { ComposeDialog } from "@/app/(dashboard)/messages/compose-dialog";
import { MessageKindBadge } from "@/components/message-kind-badge";

export const metadata: Metadata = { title: "District dashboard" };

function Stat({ label, value, icon: Icon, tone, href }: { label: string; value: number; icon: LucideIcon; tone: string; href?: string }) {
  const body = (
    <Card className="gap-0 py-4 transition-colors hover:bg-accent/30">
      <CardContent className="flex items-center justify-between gap-3 px-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{formatNumber(value)}</p>
        </div>
        <div className={`grid size-10 place-items-center rounded-xl ${tone}`}><Icon className="size-5" /></div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function DistrictDashboardPage({ searchParams }: PageProps<"/district">) {
  const user = await requireUser("reviews:read");
  // Global roles use the main dashboard; this page is for district-scoped roles (or a Super Admin previewing it).
  if (user.role === "DISTRICT_VIEWER") redirect("/review");
  if (!user.districtScopeIds.length && user.role !== "SUPER_ADMIN") redirect("/");

  const sp = await searchParams;
  const f = parseReviewFilters(sp);
  const [counts, viewers, options, reviewers, table, activity, districts, threads, compose] = await Promise.all([
    getDistrictCounts(user),
    getDistrictViewers(user),
    getFilterOptions(user),
    getReviewerOptions(user),
    getReviewTable(f, user),
    getRecentReviewActivity(user),
    user.districtScopeIds.length ? prisma.district.findMany({ where: { id: { in: user.districtScopeIds } }, orderBy: { name: "asc" }, select: { name: true } }) : [],
    listThreads(user, { take: 5 }),
    composeOptions(user),
  ]);

  const hrefFor = (page: number) => {
    const next = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && v ? [[k, v]] : [])) as [string, string][]);
    next.set("page", String(page));
    return `/district?${next.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="District dashboard"
        description={districts.length ? `Reviews in ${districts.map((d) => d.name).join(", ")}` : "All districts — Super Admin supervision view"}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="District candidates" value={counts.total} icon={UsersRound} tone="bg-accent text-brand-navy" href="/district" />
        <Stat label="Pending review" value={counts.pending} icon={Clock} tone="bg-muted text-muted-foreground" href="/district?reviewStatus=PENDING_REVIEW" />
        <Stat label="Selected" value={counts.selected} icon={CheckCircle2} tone="bg-success/10 text-success" href="/district?reviewStatus=SELECTED" />
        <Stat label="Rejected" value={counts.rejected} icon={XCircle} tone="bg-destructive/10 text-destructive" href="/district?reviewStatus=REJECTED" />
        <Stat label="Awaiting confirmation" value={counts.awaiting} icon={ShieldCheck} tone="bg-brand-orange/15 text-brand-orange" href="/district?reviewStatus=AWAITING_CONFIRMATION" />
        <Stat label="District Viewers" value={viewers.length} icon={Users} tone="bg-accent text-brand-teal" />
      </div>

      <Card className="my-6">
        <CardContent>
          <DistrictFilters districts={options.districts} departmentHeads={options.departmentHeads} departments={options.departments} designations={options.designations} reviewers={reviewers} />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <Card className="overflow-hidden py-0">
          <CardHeader className="border-b py-4">
            <CardTitle>Candidate reviews</CardTitle>
            <CardDescription>{formatNumber(table.total)} candidate{table.total === 1 ? "" : "s"} match the filters. Decisions by District Viewers appear here as soon as they are submitted.</CardDescription>
          </CardHeader>
          {table.rows.length === 0 ? (
            <EmptyState icon={UsersRound} title="No candidates" description="No candidates in your districts match these filters." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="bg-brand-navy text-left text-xs font-semibold uppercase tracking-wide text-white">
                    <th className="px-4 py-3">Candidate</th>
                    <th className="px-4 py-3">Designation</th>
                    <th className="px-4 py-3">Project</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Reviewed by</th>
                    <th className="px-4 py-3">Review date</th>
                    <th className="px-4 py-3">Comments</th>
                    <th className="w-16 px-4 py-3 text-center">View</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {table.rows.map((r) => {
                    const last = r.reviews[0];
                    return (
                      <tr key={r.id} className="hover:bg-accent/40">
                        <td className="px-4 py-2.5">
                          <p className="font-medium">{r.fullName}</p>
                          <p className="text-xs text-muted-foreground">{r.sourceEmployeeCode} · {r.district?.name ?? "—"}</p>
                        </td>
                        <td className="px-4 py-2.5 text-xs">{r.designation?.name ?? "—"}</td>
                        <td className="px-4 py-2.5 text-xs">{r.departmentHead?.name ?? "—"}</td>
                        <td className="px-4 py-2.5"><ReviewStatusBadge status={r.reviewStatus} updated={r.reviewUpdated} pendingConfirmation={r.reviewPendingConfirmation} /></td>
                        <td className="px-4 py-2.5 text-xs">{last ? (last.reviewedBy.name ?? last.reviewedBy.email) : "—"}</td>
                        <td className="px-4 py-2.5 text-xs">{r.reviewedAt ? formatDateTime(r.reviewedAt) : "—"}</td>
                        <td className="max-w-[16rem] px-4 py-2.5 text-xs">
                          {last?.remark ? <p className="truncate" title={last.remark}>{last.remark}</p> : <span className="text-muted-foreground">—</span>}
                          {r._count.comments > 0 && <p className="text-[11px] text-muted-foreground"><MessageSquare className="mr-1 inline size-3" />{r._count.comments} comment{r._count.comments === 1 ? "" : "s"}</p>}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <Button variant="ghost" size="icon-sm" asChild><Link href={`/candidates/${r.id}`} aria-label={`View ${r.fullName}`}><Eye /></Link></Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t px-4 py-3">
            <Pagination page={table.page} pageCount={table.pageCount} total={table.total} pageSize={table.pageSize} hrefFor={hrefFor} />
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">Messages</CardTitle>
                <CardDescription>To your District Viewers, with read receipts</CardDescription>
              </div>
              <ComposeDialog districts={compose} compact />
            </CardHeader>
            <CardContent>
              {threads.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No messages sent yet.</p>
              ) : (
                <ul className="divide-y text-sm" role="list">
                  {threads.rows.map((m) => (
                    <li key={m.id} className="py-2">
                      <Link href={`/messages/${m.id}`} className="flex items-center gap-2 font-medium hover:underline">
                        {m.unreadForMe && <span className="size-2 shrink-0 rounded-full bg-brand-orange" aria-label="Unread" />}
                        <span className="truncate">{m.subject}</span>
                        <MessageKindBadge kind={m.kind} />
                      </Link>
                      <p className="text-xs text-muted-foreground">{m.district.name} · read by {m.readCount}/{m.recipientCount} · {m._count.replies} repl{m._count.replies === 1 ? "y" : "ies"} · {relativeTime(m.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
              <Button variant="link" size="sm" className="mt-1 px-0" asChild><Link href="/messages">All messages</Link></Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent review activity</CardTitle>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">No decisions or comments yet.</p>
              ) : (
                <ul className="divide-y text-sm" role="list">
                  {activity.map((a) =>
                    a.kind === "review" ? (
                      <li key={a.r.id} className="py-2">
                        <p>
                          <span className="font-medium">{a.r.reviewedBy.name ?? a.r.reviewedBy.email}</span> {a.r.isOverride ? "changed" : "marked"}{" "}
                          <Link href={`/candidates/${a.r.candidate.id}`} className="text-primary hover:underline">{a.r.candidate.fullName}</Link> as{" "}
                          <span className={a.r.decision === "SELECTED" ? "font-semibold text-success" : "font-semibold text-destructive"}>{a.r.decision.toLowerCase()}</span>
                          {a.r.requiresConfirmation && !a.r.confirmedAt && <span className="text-brand-orange"> · awaiting confirmation</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">{relativeTime(a.r.createdAt)}</p>
                      </li>
                    ) : (
                      <li key={a.c.id} className="py-2">
                        <p><span className="font-medium">{a.c.author.name ?? a.c.author.email}</span> commented on <Link href={`/candidates/${a.c.candidate.id}`} className="text-primary hover:underline">{a.c.candidate.fullName}</Link></p>
                        <p className="truncate text-xs text-muted-foreground" title={a.c.body}>{a.c.body}</p>
                        <p className="text-xs text-muted-foreground">{relativeTime(a.c.createdAt)}</p>
                      </li>
                    ),
                  )}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">District Viewers</CardTitle>
              <CardDescription>Active viewers assigned to your districts</CardDescription>
            </CardHeader>
            <CardContent>
              {viewers.length === 0 ? (
                <p className="text-sm text-muted-foreground">None assigned yet.</p>
              ) : (
                <ul className="divide-y text-sm" role="list">
                  {viewers.map((v) => (
                    <li key={v.id} className="py-2">
                      <p className="font-medium">{v.name ?? v.email}</p>
                      <p className="text-xs text-muted-foreground">{v.districtAssignments.map((a) => a.district.name).join(", ")} · {v.lastLoginAt ? `signed in ${relativeTime(v.lastLoginAt)}` : "never signed in"}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
