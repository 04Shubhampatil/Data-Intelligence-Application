import { Progress } from "@/components/ui/progress";
import { formatNumber } from "@/lib/format";

type JobCounts = { totalRecords: number; processed: number; created: number; updated: number; unchanged: number; failed: number };

export function JobProgress({ job }: { job: JobCounts }) {
  const pct = job.totalRecords ? Math.min(100, Math.round((job.processed / job.totalRecords) * 100)) : 0;
  const stats: [string, number, string][] = [
    ["Created", job.created, "text-success"],
    ["Updated", job.updated, "text-brand-teal"],
    ["Unchanged", job.unchanged, "text-muted-foreground"],
    ["Failed", job.failed, "text-destructive"],
  ];
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">
          {formatNumber(job.processed)} / {job.totalRecords ? formatNumber(job.totalRecords) : "…"} processed
        </span>
        <span className="tabular-nums text-muted-foreground">{pct}%</span>
      </div>
      <Progress value={pct} aria-label="Sync progress" />
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([label, n, cls]) => (
          <div key={label} className="rounded-lg bg-muted/60 px-3 py-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className={`text-lg font-bold tabular-nums ${cls}`}>{formatNumber(n)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
