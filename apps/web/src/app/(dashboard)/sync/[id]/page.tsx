import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { AutoRefresh } from "@/components/auto-refresh";
import { requireUser } from "@/server/auth/session";
import { getJob, isActive, isResumable, jobLabel, jobOptions } from "@/server/services/sync.service";
import { formatDateTime } from "@/lib/format";
import { hasPermission } from "@/lib/rbac";
import { JobProgress } from "../job-progress";
import { JobButtons } from "../job-buttons";

export const metadata: Metadata = { title: "Sync job" };

export default async function SyncJobPage({ params }: PageProps<"/sync/[id]">) {
  const user = await requireUser("sync:read");
  const { id } = await params;
  if (!/^[a-z0-9]{1,40}$/i.test(id)) notFound();
  const job = await getJob(id);
  if (!job) notFound();

  const active = isActive(job);
  const canRun = hasPermission(user.permissions, "sync:run");
  const open = job.errors.filter((e) => !e.resolvedAt);
  const retryable = new Set(open.filter((e) => e.sourceEmployeeCode).map((e) => e.sourceEmployeeCode)).size;
  const opts = jobOptions(job.filters);
  const shownStatus = job.status === "RUNNING" && !active ? "FAILED" : job.status;

  return (
    <>
      <AutoRefresh active={active} />
      <Button variant="ghost" size="sm" asChild className="mb-4 -ml-2">
        <Link href="/sync">
          <ArrowLeft /> Back to synchronization
        </Link>
      </Button>

      <Card className="mb-6">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {jobLabel(job.filters)} <SyncStatusBadge status={shownStatus} />
              {job.mode === "RETRY" && <Badge variant="secondary">Retry</Badge>}
            </CardTitle>
            <CardDescription>
              {job.sourceConnection.name} · started {formatDateTime(job.startedAt ?? job.createdAt)}
              {job.finishedAt ? ` · finished ${formatDateTime(job.finishedAt)}` : ""}
              {job.triggeredBy ? ` · by ${job.triggeredBy.name ?? job.triggeredBy.email}` : ""}
            </CardDescription>
            {opts && (
              <p className="text-xs text-muted-foreground">
                Profiles: {opts.includeProfiles ? `yes (refresh after ${opts.profileMaxAgeDays} days)` : "no"}
                {opts.maxRecords ? ` · trial cap ${opts.maxRecords}` : ""}
              </p>
            )}
          </div>
          {canRun && (
            <JobButtons jobId={job.id} canCancel={active} canResume={!active && isResumable(job)} retryCount={active ? 0 : retryable} />
          )}
        </CardHeader>
        <CardContent>
          <JobProgress job={job} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Errors</CardTitle>
          <CardDescription>
            {open.length ? `${open.length} unresolved` : "None unresolved"}. Messages name the failing field or step, never record values.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {job.errors.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No errors.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4">When</th>
                    <th className="py-2 pr-4">Code</th>
                    <th className="py-2 pr-4">Step</th>
                    <th className="py-2 pr-4">Message</th>
                    <th className="py-2">State</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {job.errors.map((e) => (
                    <tr key={e.id}>
                      <td className="py-2 pr-4 text-xs text-muted-foreground">{formatDateTime(e.createdAt)}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{e.sourceEmployeeCode ?? "—"}</td>
                      <td className="py-2 pr-4"><Badge variant="outline">{e.stage}</Badge></td>
                      <td className="py-2 pr-4">{e.message}</td>
                      <td className="py-2 text-xs">
                        {e.resolvedAt ? <span className="text-success">Resolved</span> : e.retryCount ? `Retried ${e.retryCount}×` : "Open"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
