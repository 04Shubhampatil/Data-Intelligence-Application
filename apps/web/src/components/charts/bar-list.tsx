import { formatNumber } from "@/lib/format";

/**
 * Horizontal ranked bars — one hue, values labelled directly.
 * Used for department/project/district distributions.
 */
export function BarList({ data, emptyLabel = "No data yet" }: { data: { label: string; count: number }[]; emptyLabel?: string }) {
  if (!data.length) return <p className="py-8 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <ul className="space-y-3" role="list">
      {data.map((d) => (
        <li key={d.label} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-medium text-foreground" title={d.label}>
              {d.label}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{formatNumber(d.count)}</span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div className="h-2 rounded-full bg-chart-1" style={{ width: `${Math.max(2, (d.count / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
