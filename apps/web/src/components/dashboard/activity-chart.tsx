"use client";

import { useState } from "react";

export type ActivityPoint = { month: string; synced: number; selected: number; rejected: number };

const SERIES = [
  { key: "synced", label: "Synced", color: "#2563EB" },
  { key: "selected", label: "Verified", color: "#0E7C3A" },
  { key: "rejected", label: "Rejected", color: "#F28B82" },
] as const;

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}K` : String(n));
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short" });
const monthLong = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

/** Clean y-axis maximum and ticks (0 / 1K / 2K / 3K style). */
function niceScale(max: number) {
  if (max <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(max / step) * step;
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}

/**
 * Grouped columns per month (one y-axis). Bars ≤ 24px with a 4px rounded top, 2px gap between
 * neighbours; legend always shown; hover/focus a month for a tooltip; a table view is available.
 */
export function ActivityChart({ data }: { data: ActivityPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 640;
  const H = 240;
  const m = { top: 12, right: 8, bottom: 28, left: 40 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const max = Math.max(0, ...data.flatMap((d) => [d.synced, d.selected, d.rejected]));
  const { top, ticks } = niceScale(max);
  const band = iw / Math.max(1, data.length);
  const bar = Math.min(24, (band * 0.6 - 4) / 3);
  const groupW = bar * 3 + 4;
  const y = (v: number) => m.top + ih - (v / top) * ih;
  const colPath = (x: number, v: number) => {
    const h = Math.max(0, m.top + ih - y(v));
    if (h === 0) return "";
    const r = Math.min(4, h, bar / 2);
    const yt = m.top + ih - h;
    return `M${x},${m.top + ih} V${yt + r} Q${x},${yt} ${x + r},${yt} H${x + bar - r} Q${x + bar},${yt} ${x + bar},${yt + r} V${m.top + ih} Z`;
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground" aria-label="Legend">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setTable((t) => !t)} className="text-xs font-medium text-primary hover:underline">
          {table ? "View as chart" : "View as table"}
        </button>
      </div>

      {table ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 font-medium">Month</th>
              {SERIES.map((s) => <th key={s.key} className="py-2 text-right font-medium">{s.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.map((d) => (
              <tr key={d.month}>
                <td className="py-2">{monthLong(d.month)}</td>
                {SERIES.map((s) => <td key={s.key} className="py-2 text-right tabular-nums">{d[s.key].toLocaleString("en-IN")}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Monthly candidate activity: synced, verified and rejected">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={m.left} x2={W - m.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
                <text x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px]">{compact(t)}</text>
              </g>
            ))}
            {data.map((d, i) => {
              const gx = m.left + band * i + (band - groupW) / 2;
              return (
                <g key={d.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} className="outline-none">
                  <rect x={m.left + band * i} y={m.top} width={band} height={ih} fill={hover === i ? "var(--muted)" : "transparent"} />
                  {SERIES.map((s, k) => <path key={s.key} d={colPath(gx + k * (bar + 2), d[s.key])} fill={s.color} />)}
                  <text x={m.left + band * i + band / 2} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">{monthLabel(d.month)}</text>
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-xl border bg-popover px-3 py-2 text-xs shadow-lg"
              style={{ left: `${Math.min(78, Math.max(2, ((m.left + band * hover + band / 2) / W) * 100 - 10))}%` }}
              role="status"
            >
              <p className="mb-1 font-semibold text-foreground">{monthLong(data[hover].month)}</p>
              {SERIES.map((s) => (
                <p key={s.key} className="flex items-center justify-between gap-4 text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: s.color }} />{s.label}</span>
                  <span className="font-semibold tabular-nums text-foreground">{data[hover][s.key].toLocaleString("en-IN")}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
