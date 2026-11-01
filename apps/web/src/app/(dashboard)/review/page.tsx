import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Clock, Eye, FileText, Inbox, MapPin, UsersRound, XCircle, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/pagination";
import { ReviewStatusBadge } from "@/components/review-status-badge";
import { EmptyState } from "@/components/empty-state";
import { requireUser } from "@/server/auth/session";
import { getDistrictCounts, getViewerQueue } from "@/server/services/district.service";
import { twoStepEnabled } from "@/server/services/review.service";
import { prisma } from "@di/db";
import { formatDateTime, formatNumber } from "@/lib/format";
import { hasPermission } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { QuickDecision } from "./quick-decision";
import { listThreads } from "@/server/services/message.service";
import { MessageKindBadge } from "@/components/message-kind-badge";
import { relativeTime } from "@/lib/format";

export const metadata: Metadata = { title: "My reviews" };

const TABS = [
  { key: "PENDING_REVIEW", label: "Pending" },
  { key: "SELECTED", label: "Selected" },
  { key: "REJECTED", label: "Rejected" },
  { key: "ALL", label: "All" },
] as const;

function Stat({ label, value, icon: Icon, tone }: { label: string; value: number; icon: LucideIcon; tone: string }) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="flex items-center justify-between gap-3 px-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{formatNumber(value)}</p>
        </div>
        <div className={`grid size-10 place-items-center rounded-xl ${tone}`}><Icon className="size-5" /></div>
      </CardContent>
    </Card>
  );
}

export default async function ReviewQueuePage({ searchParams }: PageProps<"/review">) {
  const user = await requireUser("reviews:read");
  if (!user.districtScopeIds.length && user.role !== "SUPER_ADMIN") redirect("/");
  const sp = await searchParams;
  const status = (TABS.find((t) => t.key === sp.status)?.key ?? "PENDING_REVIEW") as (typeof TABS)[number]["key"];
  const page = Math.max(1, Number(sp.page) || 1);
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : undefined;

  const [counts, queue, twoStep, districts, threads] = await Promise.all([
    getDistrictCounts(user),
    getViewerQueue(user, status, page, q),
    twoStepEnabled(),
    user.districtScopeIds.length ? prisma.district.findMany({ where: { id: { in: user.districtScopeIds } }, select: { name: true }, orderBy: { name: "asc" } }) : [],
    listThreads(user, { take: 5 }),
  ]);
  const canDecide = hasPermission(user.permissions, "reviews:decide");
  const canOverride = hasPermission(user.permissions, "reviews:override");
  const hrefFor = (p: number) => `/review?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ""}&page=${p}`;

  return (
    <>
      <PageHeader
        title="My reviews"
        description={
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-4" /> {districts.length ? districts.map((d) => d.name).join(", ") : "All districts"}
            {twoStep && user.role === "DISTRICT_VIEWER" && <span className="text-xs text-muted-foreground">· your decisions are confirmed by the District Admin</span>}
          </span>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Candidates available" value={counts.total} icon={UsersRound} tone="bg-accent text-brand-navy" />
        <Stat label="Pending review" value={counts.pending} icon={Clock} tone="bg-muted text-muted-foreground" />
        <Stat label="Selected" value={counts.selected} icon={CheckCircle2} tone="bg-success/10 text-success" />
        <Stat label="Rejected" value={counts.rejected} icon={XCircle} tone="bg-destructive/10 text-destructive" />
      </div>

      <div className="my-6 grid gap-6 xl:grid-cols-[1fr_20rem]">
        <Card className="overflow-hidden py-0">
          <CardHeader className="border-b py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Candidates</CardTitle>
                <CardDescription>{formatNumber(queue.total)} {status === "ALL" ? "in your district" : status.replace("_", " ").toLowerCase()}</CardDescription>
              </div>
              <nav className="flex gap-1.5" aria-label="Review status">
                {TABS.map((t) => (
                  <Link
                    key={t.key}
                    href={`/review?status=${t.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                    className={cn("rounded-full border px-3 py-1 text-xs font-medium", t.key === status ? "border-brand-navy bg-brand-navy text-white" : "bg-card hover:bg-accent")}
                  >
                    {t.label}
                  </Link>
                ))}
              </nav>
            </div>
            <form className="mt-3 flex gap-2" role="search">
              <input type="hidden" name="status" value={status} />
              <input name="q" defaultValue={q} placeholder="Search by name or code" maxLength={80} className="h-9 flex-1 rounded-lg border bg-card px-3 text-sm" aria-label="Search" />
              <Button type="submit" size="sm" className="h-9">Search</Button>
            </form>
          </CardHeader>
          {queue.rows.length === 0 ? (
            <EmptyState icon={Inbox} title="Nothing here" description={status === "PENDING_REVIEW" ? "No candidates are waiting for your review." : "No candidates with this status."} />
          ) : (
            <ul className="divide-y" role="list">
              {queue.rows.map((c) => {
                const decided = c.reviewStatus !== "PENDING_REVIEW";
                return (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-accent/30">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        <Link href={`/candidates/${c.id}`} className="hover:underline">{c.fullName}</Link>
                        <ReviewStatusBadge status={c.reviewStatus} updated={c.reviewUpdated} pendingConfirmation={c.reviewPendingConfirmation} />
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {c.sourceEmployeeCode} · {c.designation?.name ?? "—"} · {c.departmentHead?.name ?? "—"}{c.taluka ? ` · ${c.taluka}` : ""}
                        {c.reviewedAt ? ` · reviewed ${formatDateTime(c.reviewedAt)}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button size="sm" variant="ghost" asChild>
                        <Link href={`/candidates/${c.id}`}><Eye /> Profile</Link>
                      </Button>
                      <Button size="sm" variant="ghost" asChild>
                        <Link href={`/candidates/${c.id}#documents`}><FileText /> {c._count.documents} doc{c._count.documents === 1 ? "" : "s"}</Link>
                      </Button>
                      {canDecide && <QuickDecision candidateId={c.id} candidateName={c.fullName} disabled={decided && !canOverride} twoStep={twoStep && user.role === "DISTRICT_VIEWER"} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="border-t px-4 py-3">
            <Pagination page={queue.page} pageCount={queue.pageCount} total={queue.total} pageSize={queue.pageSize} hrefFor={hrefFor} />
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Messages from your District Admin</CardTitle>
            <CardDescription>Announcements and instructions appear here.</CardDescription>
          </CardHeader>
          <CardContent>
            {threads.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No messages yet.</p>
            ) : (
              <ul className="divide-y text-sm" role="list">
                {threads.rows.map((m) => (
                  <li key={m.id} className="py-2">
                    <Link href={`/messages/${m.id}`} className="flex items-center gap-2 hover:underline">
                      {m.unreadForMe && <span className="size-2 shrink-0 rounded-full bg-brand-orange" aria-label="Unread" />}
                      <span className={m.unreadForMe ? "truncate font-semibold" : "truncate font-medium"}>{m.subject}</span>
                      <MessageKindBadge kind={m.kind} />
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">{m.body}</p>
                    <p className="text-xs text-muted-foreground">{m.sender.name ?? m.sender.email} · {relativeTime(m.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
            <Button variant="link" size="sm" className="mt-1 px-0" asChild><Link href="/messages">All messages</Link></Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
