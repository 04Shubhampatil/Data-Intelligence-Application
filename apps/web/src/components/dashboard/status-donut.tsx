import { formatNumber } from "@/lib/format";

export type DonutSlice = { label: string; value: number; color: string };

const pct = (v: number, total: number) => (total ? (v / total) * 100 : 0);
const fmtPct = (p: number) => (p === 0 ? "0%" : p < 0.1 ? "<0.1%" : p >= 99.95 && p < 100 ? ">99.9%" : `${p.toFixed(p < 10 ? 2 : 1).replace(/\.?0+$/, "")}%`);

/**
 * Review-status donut. Segments are separated by a 2px surface gap; every slice is named in the
 * legend with its count and share, so colour is never the only cue. Tiny slices keep a minimum
 * visible arc so they don't disappear.
 */
export function StatusDonut({ slices, total }: { slices: DonutSlice[]; total: number }) {
  const r = 52;
  const stroke = 16;
  const c = 2 * Math.PI * r;
  const gap = total ? 2 : 0;
  const minArc = 3;
  const arcs: ((typeof slices)[number] & { dash: string; offset: number })[] = [];
  let offset = 0;
  for (const s of slices) {
    if (s.value <= 0) continue;
    const len = Math.max(minArc, (s.value / Math.max(total, 1)) * c - gap);
    arcs.push({ ...s, dash: `${len} ${c - len}`, offset: -offset });
    offset += len + gap;
  }
  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-8">
      <svg viewBox="0 0 140 140" className="size-40 shrink-0 -rotate-90" role="img" aria-label={`Review status of ${formatNumber(total)} candidates`}>
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        {arcs.map((a) => (
          <circle key={a.label} cx="70" cy="70" r={r} fill="none" stroke={a.color} strokeWidth={stroke} strokeDasharray={a.dash} strokeDashoffset={a.offset}>
            <title>{`${a.label}: ${formatNumber(a.value)} (${fmtPct(pct(a.value, total))})`}</title>
          </circle>
        ))}
        <g className="rotate-90" style={{ transformOrigin: "70px 70px" }}>
          <text x="70" y="68" textAnchor="middle" className="fill-foreground text-[22px] font-bold">{formatNumber(total)}</text>
          <text x="70" y="86" textAnchor="middle" className="fill-muted-foreground text-[10px]">Total</text>
        </g>
      </svg>
      <ul className="w-full space-y-3.5 text-sm" role="list">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-3">
            <span className="size-3 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
            <span className="flex-1 text-foreground">{s.label}</span>
            <span className="tabular-nums text-muted-foreground">{formatNumber(s.value)}</span>
            <span className="w-16 text-right font-semibold tabular-nums text-foreground">{fmtPct(pct(s.value, total))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
