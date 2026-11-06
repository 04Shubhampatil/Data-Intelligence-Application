import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Cpu, History, KeyRound, Play, RefreshCw, Terminal } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { AutoRefresh } from "@/components/auto-refresh";
import { requireUser } from "@/server/auth/session";
import { sourceCommands } from "@/lib/source-commands";
import { getRecentJobs, getSources, getWorkerStatus, isActive, isResumable, jobLabel, jobOptions, listSchedules, isQueuedTooLong } from "@/server/services/sync.service";
import { DEFAULT_TIME_ZONE, describeSync } from "@di/core";
import { SchedulesCard } from "./schedules-card";
import { formatDateTime, formatNumber, relativeTime } from "@/lib/format";
import { hasPermission } from "@/lib/rbac";
import { StartSyncForm } from "./start-sync-form";
import { JobProgress } from "./job-progress";
import { JobButtons } from "./job-buttons";

export const metadata: Metadata = { title: "Data Synchronization" };

export default async function SyncPage() {
  const user = await requireUser("sync:read");
  const canRun = hasPermission(user.permissions, "sync:run");
  const [sources, jobs, schedules, worker] = await Promise.all([getSources(), getRecentJobs(), listSchedules(), getWorkerStatus()]);
  const active = jobs.find(isActive);
  const queuedTooLong = isQueuedTooLong(active);
  const timeZone = process.env.TZ || DEFAULT_TIME_ZONE;
  const scheduleRows = schedules.map((s) => {
    const o = jobOptions(s.options);
    return { id: s.id, name: s.name, frequency: s.frequency, minute: s.minute, hour: s.hour, weekday: s.weekday, enabled: s.enabled, nextRunAt: s.nextRunAt, lastRunAt: s.lastRunAt, lastJobId: s.lastJobId, lastStatus: s.lastStatus, scopeLabel: o ? describeSync(o) : "—" };
  });

  return (
    <>
      <AutoRefresh active={!!active} />
      <PageHeader
        title="Data Synchronization"
        description="Read-only sync of approved fields from the source dashboard."
        actions={
          <Badge className={worker.online ? "border-0 bg-success/10 text-success" : "border-0 bg-destructive/10 text-destructive"} title={worker.seenAt ? `Last seen ${formatDateTime(worker.seenAt)}${worker.host ? ` on ${worker.host}` : ""}` : "No worker has ever reported in"}>
            <Cpu className="mr-1 size-3" /> Worker {worker.online ? "online" : "offline"}
            {worker.online && worker.currentJobId ? " · busy" : ""}
          </Badge>
        }
      />
      {!worker.online && (
        <Alert className="mb-6">
          <AlertTriangle />
          <AlertTitle>No sync worker is running</AlertTitle>
          <AlertDescription>
            Syncs started here and schedules wait until a worker is up. Start it on the server with <code className="font-mono">npm run source:worker</code> (or the <code className="font-mono">worker</code> container).
            {worker.seenAt ? ` Last seen ${relativeTime(worker.seenAt)}.` : ""}
          </AlertDescription>
        </Alert>
      )}

      {sources.length === 0 && (
        <Alert className="mb-6">
          <Terminal />
          <AlertTitle>No source configured</AlertTitle>
          <AlertDescription>
            Run <code className="font-mono">npm run source:setup</code> on the server, then sign in with <code className="font-mono">npm run source:login</code>.
          </AlertDescription>
        </Alert>
      )}

      {active && (
        <Card className="mb-6 border-brand-teal/30">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="size-4 animate-spin text-brand-teal" /> {jobLabel(active.filters)}
                <SyncStatusBadge status={active.status} />
              </CardTitle>
              <CardDescription>
                Started {relativeTime(active.startedAt ?? active.createdAt)} ·{" "}
                <Link href={`/sync/${active.id}`} className="font-medium text-primary hover:underline">Details</Link>
              </CardDescription>
            </div>
            {canRun && <JobButtons jobId={active.id} canCancel canResume={false} retryCount={0} />}
          </CardHeader>
          <CardContent>
            {queuedTooLong && worker.online && <p className="mb-3 text-xs text-muted-foreground">Queued — the worker will start it shortly.</p>}
            <JobProgress job={active} />
          </CardContent>
        </Card>
      )}

      {sources.map((s) => (
        <div key={s.id} className="mb-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Play className="size-4" /> Start a sync{sources.length > 1 ? ` · ${s.name}` : ""}
              </CardTitle>
              <CardDescription>Start with one district to review results before syncing everything.</CardDescription>
            </CardHeader>
            <CardContent>
              {canRun ? (
                <StartSyncForm
                  sourceId={s.id}
                  districts={s.districts}
                  disabled={!!active || !s.sessionSavedAt}
                  disabledReason={active ? "A sync is already in progress." : !s.sessionSavedAt ? `Sign in to the source first (${sourceCommands(s.adapterKey).login}).` : undefined}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Your role can view sync status but not start syncs.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                <KeyRound className="size-4" /> {s.name}
                <Badge className={s.sessionSavedAt ? "border-0 bg-success/10 text-success" : "border-0 bg-muted text-muted-foreground"}>
                  {s.sessionSavedAt ? "Session saved" : "Not signed in"}
                </Badge>
              </CardTitle>
              <CardDescription>
                {s.baseUrl} · read-only
                {s.sessionSavedAt ? ` · signed in ${relativeTime(s.sessionSavedAt)}` : ""}
                {s.lastSyncedAt ? ` · last sync ${relativeTime(s.lastSyncedAt)}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Approved fields</p>
              <div className="flex flex-wrap gap-1.5">
                {s.fieldPolicies.map((f) => (
                  <Badge
                    key={f.fieldKey}
                    variant="outline"
                    className={f.allowed ? "font-normal" : "font-normal text-muted-foreground line-through"}
                    title={f.allowed ? "Stored" : "Not approved — never stored"}
                  >
                    {f.fieldKey}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ))}

      {sources[0] && (
        <div className="mb-6">
          <SchedulesCard sourceId={sources[0].id} districts={sources[0].districts} schedules={scheduleRows} canRun={canRun} timeZone={timeZone} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-4" /> Synchronization history
          </CardTitle>
          <CardDescription>Most recent 20 jobs</CardDescription>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No sync jobs yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4">Started</th>
                    <th className="py-2 pr-4">Scope</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4 text-right">Processed</th>
                    <th className="py-2 pr-4 text-right">New / Upd. / Same</th>
                    <th className="py-2 pr-4 text-right">Failed</th>
                    <th className="py-2">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {jobs.map((j) => (
                    <tr key={j.id} className="hover:bg-accent/40">
                      <td className="py-2.5 pr-4">
                        <Link href={`/sync/${j.id}`} className="font-medium text-primary hover:underline">
                          {formatDateTime(j.startedAt ?? j.createdAt)}
                        </Link>
                      </td>
                      <td className="py-2.5 pr-4">
                        {sources.length > 1 && <span className="text-muted-foreground">{j.sourceConnection.name} · </span>}
                        {jobLabel(j.filters)}
                      </td>
                      <td className="py-2.5 pr-4">
                        <SyncStatusBadge status={j.status === "RUNNING" && !isActive(j) ? "FAILED" : j.status} />
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">
                        {formatNumber(j.processed)}
                        {j.totalRecords ? <span className="text-muted-foreground"> / {formatNumber(j.totalRecords)}</span> : null}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">
                        {j.created} / {j.updated} / {j.unchanged}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">{formatNumber(j.failed)}</td>
                      <td className="max-w-xs truncate py-2.5 text-xs text-muted-foreground" title={j.errors[0]?.message}>
                        {j.errors[0] ? `${j.errors[0].stage}: ${j.errors[0].message}` : isResumable(j) ? "Can be resumed" : ""}
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
