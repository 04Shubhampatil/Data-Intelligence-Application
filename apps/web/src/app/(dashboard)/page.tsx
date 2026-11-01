import type { Metadata } from "next";
import Link from "next/link";
import { Activity, CheckCircle2, Database, RefreshCw, Users, XCircle, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { BarList } from "@/components/charts/bar-list";
import { EmptyState } from "@/components/empty-state";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { requireUser } from "@/server/auth/session";
import { getDashboardData } from "@/server/services/dashboard.service";
import { formatDateTime, formatNumber, relativeTime } from "@/lib/format";
import { hasPermission, homeFor } from "@/lib/rbac";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Dashboard" };

const ACTION_LABELS: Record<string, string> = {
  LOGIN: "Signed in",
  LOGIN_FAILED: "Failed sign-in",
  LOGIN_LOCKED: "Sign-in blocked (locked)",
  LOGOUT: "Signed out",
  PASSWORD_RESET_REQUESTED: "Requested password reset",
  PASSWORD_RESET: "Reset password",
  SEARCH: "Searched records",
  EXPORT: "Exported data",
  AI_QUERY: "Asked the AI assistant",
  SYNC_START: "Started a sync",
  SYNC_CANCEL: "Cancelled a sync",
  SYNC_ALERT: "Sync needs attention",
  SCHEDULE_UPDATE: "Changed a sync schedule",
  DATA_PURGE: "Ran data retention cleanup",
  USER_CREATE: "Created a user",
  USER_UPDATE: "Changed a user account",
  ACCESS_DENIED: "Tried to open a record outside their districts",
  DOCUMENT_VIEW: "Viewed a candidate document",
  REVIEW_DECIDE: "Decided on a candidate",
  REVIEW_OVERRIDE: "Changed a candidate decision",
  REVIEW_CONFIRM: "Confirmed a viewer decision",
  COMMENT_ADD: "Added a review comment",
  MESSAGE_SEND: "Sent a district message",
  MESSAGE_REPLY: "Replied to a district message",
  ERASURE: "Erased a record on request",
  SETTINGS_UPDATE: "Updated settings",
};

function StatCard({ label, value, icon: Icon, tone, hint }: { label: string; value: React.ReactNode; icon: LucideIcon; tone: string; hint?: React.ReactNode }) {
  return (
    <Card className="gap-0 py-5">
      <CardContent className="flex items-start justify-between gap-4 px-5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <div className="mt-2 text-3xl font-bold tracking-tight tabular-nums text-foreground">{value}</div>
          {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
        </div>
        <div className={`grid size-11 shrink-0 place-items-center rounded-xl ${tone}`}>
          <Icon className="size-5" />
        </div>
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  const user = await requireUser("dashboard:read");
  // District roles have their own dashboards (design §6); the global dashboard stays for global roles.
  const home = homeFor(user.role);
  if (home !== "/") redirect(home);
  const data = await getDashboardData(user);
  const job = data.latestJob;
  const canSync = hasPermission(user.permissions, "sync:run");

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Overview of synced resource records and synchronization health."
        actions={
          canSync && (
            <Button asChild>
              <Link href="/sync">
                <RefreshCw /> Data synchronization
              </Link>
            </Button>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total synced candidates" value={formatNumber(data.totalCandidates)} icon={Users} tone="bg-accent text-brand-navy" />
        <StatCard
          label="Latest sync status"
          value={<SyncStatusBadge status={job?.status} />}
          icon={RefreshCw}
          tone="bg-accent text-brand-teal"
          hint={job ? formatDateTime(job.finishedAt ?? job.startedAt ?? job.createdAt) : "No sync has run yet"}
        />
        <StatCard label="Successful records" value={formatNumber(data.successful)} icon={CheckCircle2} tone="bg-success/10 text-success" hint="In the latest sync" />
        <StatCard label="Failed records" value={formatNumber(data.failed)} icon={XCircle} tone="bg-destructive/10 text-destructive" hint="In the latest sync" />
      </div>

      {data.totalCandidates === 0 && (
        <Card className="mt-6">
          <EmptyState
            icon={Database}
            title="No records synced yet"
            description="Candidate data appears here after the first approved sync from the source dashboard. The extraction worker is built in Phase 3."
            action={
              canSync && (
                <Button variant="outline" asChild>
                  <Link href="/sync">Go to Data Synchronization</Link>
                </Button>
              )
            }
          />
        </Card>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Department / Project distribution</CardTitle>
            <CardDescription>Top departments by number of records</CardDescription>
          </CardHeader>
          <CardContent>
            <BarList data={data.byProject} emptyLabel="Distribution appears after the first sync." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>District distribution</CardTitle>
            <CardDescription>Top districts by number of records</CardDescription>
          </CardHeader>
          <CardContent>
            <BarList data={data.byDistrict} emptyLabel="Distribution appears after the first sync." />
            {data.unassignedDistrict > 0 && (
              <p className="mt-3 text-xs text-brand-orange">{formatNumber(data.unassignedDistrict)} record(s) have no district at the source and are visible to global roles only.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>
            {hasPermission(user.permissions, "audit:read") ? "Latest actions across all users" : "Your latest actions"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.recentActivity.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <ul className="divide-y" role="list">
              {data.recentActivity.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-3 text-sm">
                  <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <Activity className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{ACTION_LABELS[a.action] ?? a.action}</p>
                    <p className="truncate text-xs text-muted-foreground">{a.user?.name ?? a.user?.email ?? "Unknown user"}</p>
                  </div>
                  <time className="shrink-0 text-xs text-muted-foreground" dateTime={a.createdAt.toISOString()} title={formatDateTime(a.createdAt)}>
                    {relativeTime(a.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
