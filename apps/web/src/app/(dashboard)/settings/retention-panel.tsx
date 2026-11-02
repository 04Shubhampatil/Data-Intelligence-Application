"use client";

import { useActionState, useEffect, useTransition } from "react";
import { AlertTriangle, Database, Eraser, HardDrive, Loader2, Play, Save, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime, formatNumber, relativeTime } from "@/lib/format";
import { eraseCandidateAction, runCleanupAction, saveRetentionAction, unsuppressAction, type RetentionState } from "./retention-actions";

type Settings = { syncLogDays: number; auditLogDays: number; assistantResultDays: number; reportRunDays: number; removedAtSourcePurgeDays: number };
type LastCleanup = { ranAt: string; syncJobs: number; auditLogs: number; assistantResults: number; reportRuns: number; purgedCandidates: number } | null;
type Suppressed = { sourceEmployeeCode: string; reason: string | null; createdAt: Date };
type Backup = { name: string; size: number; modifiedAt: Date };

const FIELDS: { key: keyof Settings; label: string; hint: string }[] = [
  { key: "syncLogDays", label: "Sync history", hint: "Sync jobs, per-record log and errors" },
  { key: "auditLogDays", label: "Audit log", hint: "Sign-ins, searches, exports, AI queries" },
  { key: "assistantResultDays", label: "Assistant results", hint: "Saved query parameters behind Excel exports" },
  { key: "reportRunDays", label: "Report history", hint: "Your recent exports on the Reports page" },
  { key: "removedAtSourcePurgeDays", label: "Purge records removed at source", hint: "Hard-delete candidates no longer on MahaHRD, this many days after they disappear" },
];

function useToast(state: RetentionState) {
  useEffect(() => {
    if (state?.ok) toast.success(state.message);
    else if (state?.error) toast.error(state.error);
  }, [state]);
}

export function RetentionPanel({ settings, lastCleanup, suppressed, backups, backupDir, backupAgeH, canWrite }: { settings: Settings; lastCleanup: LastCleanup; suppressed: Suppressed[]; backups: Backup[]; backupDir: string; backupAgeH: number | null; canWrite: boolean }) {
  const [saveState, saveAction, saving] = useActionState(saveRetentionAction, undefined);
  const [eraseState, eraseAction, erasing] = useActionState(eraseCandidateAction, undefined);
  const [cleanupPending, startCleanup] = useTransition();
  useToast(saveState);
  useToast(eraseState);

  const latest = backups[0];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Database className="size-4" /> Retention periods</CardTitle>
          <CardDescription>Days to keep each kind of data. 0 = keep forever. Candidate records themselves are kept while they exist at the source.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveAction} className="space-y-4">
            {FIELDS.map((f) => (
              <div key={f.key} className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor={f.key}>{f.label}</Label>
                  <p className="text-xs text-muted-foreground">{f.hint}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Input id={f.key} name={f.key} type="number" min={0} max={3650} defaultValue={settings[f.key]} disabled={!canWrite} className="h-9 w-24 bg-card text-right" />
                  <span className="text-xs text-muted-foreground">days</span>
                </div>
              </div>
            ))}
            {canWrite && (
              <div className="flex flex-wrap gap-2 pt-2">
                <Button type="submit" disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <Save />} Save</Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={cleanupPending}
                  onClick={() =>
                    startCleanup(async () => {
                      const r = await runCleanupAction();
                      if (r?.ok) toast.success(r.message);
                      else if (r?.error) toast.error(r.error);
                    })
                  }
                >
                  {cleanupPending ? <Loader2 className="animate-spin" /> : <Play />} Run cleanup now
                </Button>
              </div>
            )}
          </form>
          <p className="mt-4 text-xs text-muted-foreground">
            {lastCleanup
              ? `Last cleanup ${relativeTime(lastCleanup.ranAt)}: ${lastCleanup.syncJobs} sync jobs, ${lastCleanup.auditLogs} audit rows, ${lastCleanup.purgedCandidates} purged candidates.`
              : "Cleanup has not run yet. The worker runs it once a day."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><HardDrive className="size-4" /> Backups</CardTitle>
          <CardDescription>Daily MySQL dumps written by the backup container to <code className="font-mono">{backupDir}</code>, 14-day retention.</CardDescription>
        </CardHeader>
        <CardContent>
          {backups.length === 0 ? (
            <Alert>
              <AlertTriangle />
              <AlertTitle>No backup files found</AlertTitle>
              <AlertDescription>Expected in production (Docker Compose runs the backup service). On a development machine this is normal.</AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2 text-sm">
                <Badge className={backupAgeH !== null && backupAgeH < 26 ? "border-0 bg-success/10 text-success" : "border-0 bg-destructive/10 text-destructive"}>
                  {backupAgeH !== null && backupAgeH < 26 ? "Healthy" : "Stale"}
                </Badge>
                Latest {relativeTime(latest.modifiedAt)} · {formatNumber(Math.round(latest.size / 1024))} KB · {backups.length} file{backups.length === 1 ? "" : "s"}
              </div>
              <ul className="max-h-48 divide-y overflow-auto text-xs">
                {backups.slice(0, 14).map((b) => (
                  <li key={b.name} className="flex justify-between py-1.5">
                    <span className="font-mono">{b.name}</span>
                    <span className="text-muted-foreground">{formatDateTime(b.modifiedAt)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Eraser className="size-4" /> Right to erasure</CardTitle>
          <CardDescription>
            Deletes everything stored about one employee code (record, contact data, sync log rows) and blocks the code so future syncs skip it. Only the code is kept, on the block list. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {canWrite ? (
            <form action={eraseAction} className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="erase-code">Employee code</Label>
                <Input id="erase-code" name="code" placeholder="E1234" required pattern="[A-Za-z]{1,4}\d{1,10}" className="h-9 bg-card font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="erase-reason">Reason (optional)</Label>
                <Input id="erase-reason" name="reason" maxLength={200} placeholder="e.g. erasure request received on 1 Nov" className="h-9 bg-card" />
              </div>
              <Button type="submit" variant="destructive" disabled={erasing}>{erasing ? <Loader2 className="animate-spin" /> : <Eraser />} Erase</Button>
              <label className="flex items-center gap-2 text-sm sm:col-span-3">
                <Checkbox name="confirm" /> I confirm this erasure is authorised and understand it is permanent.
              </label>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">Only a Super Admin can erase records.</p>
          )}

          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Blocked codes ({suppressed.length})</p>
            {suppressed.length === 0 ? (
              <p className="text-sm text-muted-foreground">None.</p>
            ) : (
              <ul className="divide-y text-sm">
                {suppressed.map((s) => (
                  <SuppressedRow key={s.sourceEmployeeCode} s={s} canWrite={canWrite} />
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SuppressedRow({ s, canWrite }: { s: Suppressed; canWrite: boolean }) {
  const [pending, start] = useTransition();
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div>
        <span className="font-mono">{s.sourceEmployeeCode}</span>
        <span className="ml-2 text-xs text-muted-foreground">{s.reason ? `${s.reason} · ` : ""}{formatDateTime(s.createdAt)}</span>
      </div>
      {canWrite && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => unsuppressAction(s.sourceEmployeeCode))} title="Allow this code to be synced again">
          {pending ? <Loader2 className="animate-spin" /> : <ShieldOff />} Unblock
        </Button>
      )}
    </li>
  );
}
