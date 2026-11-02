"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { CalendarClock, Loader2, Pause, Play, Plus, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
// Browser component: import the schedule helpers only, never the "@di/core" barrel (it re-exports server-only fs/crypto modules).
import { describeSchedule } from "@di/core/schedule";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SyncStatusBadge } from "@/components/sync-status-badge";
import { formatDateTime, relativeTime } from "@/lib/format";
import { createScheduleAction, deleteScheduleAction, runScheduleNowAction, toggleScheduleAction } from "./schedule-actions";

type Option = { value: string; label: string };
export type ScheduleRow = {
  id: string;
  name: string;
  frequency: "HOURLY" | "DAILY" | "WEEKLY";
  minute: number;
  hour: number;
  weekday: number;
  enabled: boolean;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastJobId: string | null;
  lastStatus: string | null;
  scopeLabel: string;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n: number) => String(n).padStart(2, "0");

export function SchedulesCard({ sourceId, districts, schedules, canRun, timeZone }: { sourceId: string; districts: Option[]; schedules: ScheduleRow[]; canRun: boolean; timeZone: string }) {
  const [showForm, setShowForm] = useState(false);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="size-4" /> Schedules
          </CardTitle>
          <CardDescription>Automatic syncs run by the worker. Times are {timeZone}. A due schedule is skipped if a sync is already running.</CardDescription>
        </div>
        {canRun && (
          <Button size="sm" variant={showForm ? "outline" : "default"} onClick={() => setShowForm((v) => !v)}>
            <Plus /> {showForm ? "Close" : "New schedule"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {showForm && <ScheduleForm sourceId={sourceId} districts={districts} onDone={() => setShowForm(false)} />}
        {schedules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No schedules yet.</p>
        ) : (
          <ul className="divide-y" role="list">
            {schedules.map((s) => (
              <ScheduleItem key={s.id} s={s} canRun={canRun} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ScheduleItem({ s, canRun }: { s: ScheduleRow; canRun: boolean }) {
  const [pending, start] = useTransition();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {s.name}
          <Badge variant="secondary">{describeSchedule(s)}</Badge>
          {!s.enabled && <Badge className="border-0 bg-muted text-muted-foreground">Paused</Badge>}
        </p>
        <p className="text-xs text-muted-foreground">
          {s.scopeLabel}
          {s.enabled && s.nextRunAt ? ` · next ${formatDateTime(s.nextRunAt)}` : ""}
          {s.lastRunAt ? ` · last ${relativeTime(s.lastRunAt)}` : " · never run"}
        </p>
        {s.lastStatus && (
          <p className="mt-1 text-xs">
            Last result: <SyncStatusBadge status={s.lastStatus} />{" "}
            {s.lastJobId && (
              <a href={`/sync/${s.lastJobId}`} className="text-primary hover:underline">details</a>
            )}
          </p>
        )}
      </div>
      {canRun && (
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" disabled={pending} onClick={() => start(() => runScheduleNowAction(s.id))} title="Queue a run now">
            <Zap /> Run now
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => start(() => toggleScheduleAction(s.id, !s.enabled))}>
            {s.enabled ? <Pause /> : <Play />} {s.enabled ? "Pause" : "Resume"}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={pending}
            aria-label="Delete schedule"
            onClick={() => {
              if (confirm(`Delete schedule "${s.name}"?`)) start(() => deleteScheduleAction(s.id));
            }}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
          </Button>
        </div>
      )}
    </li>
  );
}

function ScheduleForm({ sourceId, districts, onDone }: { sourceId: string; districts: Option[]; onDone: () => void }) {
  const [state, action, pending] = useActionState(createScheduleAction, undefined);
  const [frequency, setFrequency] = useState<"HOURLY" | "DAILY" | "WEEKLY">("DAILY");
  const [weekday, setWeekday] = useState("1");
  const [scope, setScope] = useState<"all" | "district">("all");
  const [district, setDistrict] = useState("");
  const [profiles, setProfiles] = useState(true);

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message);
      onDone();
    } else if (state?.error) toast.error(state.error);
  }, [state, onDone]);

  return (
    <form action={action} className="space-y-4 rounded-xl border bg-muted/30 p-4">
      <input type="hidden" name="sourceId" value={sourceId} />
      <input type="hidden" name="frequency" value={frequency} />
      <input type="hidden" name="weekday" value={weekday} />
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="district" value={district} />
      {profiles && <input type="hidden" name="includeProfiles" value="on" />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="sch-name" className="text-xs font-semibold uppercase text-muted-foreground">Name</Label>
          <Input id="sch-name" name="name" required minLength={2} maxLength={60} placeholder="e.g. Nightly full sync" className="h-9 bg-card" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase text-muted-foreground">Frequency</Label>
          <Select value={frequency} onValueChange={(v) => setFrequency(v as typeof frequency)}>
            <SelectTrigger className="h-9 w-full bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="HOURLY">Every hour</SelectItem>
              <SelectItem value="DAILY">Daily</SelectItem>
              <SelectItem value="WEEKLY">Weekly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {frequency === "WEEKLY" && (
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Day</Label>
            <Select value={weekday} onValueChange={setWeekday}>
              <SelectTrigger className="h-9 w-full bg-card"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WEEKDAYS.map((d, i) => <SelectItem key={d} value={String(i)}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase text-muted-foreground">{frequency === "HOURLY" ? "Minute past the hour" : "Time"}</Label>
          <div className="flex items-center gap-1">
            {frequency !== "HOURLY" && (
              <>
                <Input name="hour" type="number" min={0} max={23} defaultValue={2} aria-label="Hour" className="h-9 w-16 bg-card" />
                <span>:</span>
              </>
            )}
            <Input name="minute" type="number" min={0} max={59} defaultValue={0} aria-label="Minute" className="h-9 w-16 bg-card" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase text-muted-foreground">Scope</Label>
          <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
            <SelectTrigger className="h-9 w-full bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All records</SelectItem>
              <SelectItem value="district" disabled={!districts.length}>One district</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {scope === "district" && (
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">District</Label>
            <Select value={district} onValueChange={setDistrict}>
              <SelectTrigger className="h-9 w-full bg-card"><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>
                {districts.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <label className="flex items-start gap-2.5 text-sm">
        <Checkbox checked={profiles} onCheckedChange={(v) => setProfiles(v === true)} className="mt-0.5" />
        <span>
          Read profile pages
          <span className="block text-xs text-muted-foreground">Profiles read in the last 7 days are skipped, so repeat runs are quick.</span>
        </span>
      </label>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending || (scope === "district" && !district)}>
          {pending ? <Loader2 className="animate-spin" /> : <Plus />} Create schedule
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
      {frequency !== "HOURLY" && <p className="text-xs text-muted-foreground">Default {pad(2)}:{pad(0)} runs at night when the source is quiet.</p>}
    </form>
  );
}
