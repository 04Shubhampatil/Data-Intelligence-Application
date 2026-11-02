/**
 * Single-series sparkline for a stat tile (no legend: the tile label names it).
 * 2px line, ~10% area wash, end dot with a surface ring. Server-rendered SVG.
 */
export function Sparkline({ values, color, label, months }: { values: number[]; color: string; label: string; months?: string[] }) {
  const w = 96;
  const h = 34;
  const pad = 4;
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (w - pad * 2)) / (values.length - 1);
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M${pts.join(" L")}`;
  const area = `${line} L${x(values.length - 1).toFixed(1)},${h} L${x(0).toFixed(1)},${h} Z`;
  const last = values.length - 1;
  const summary = months ? values.map((v, i) => `${months[i]}: ${v}`).join(", ") : values.join(", ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={`${label} over the last ${values.length} months`} className="shrink-0 overflow-visible">
      <title>{`${label} — ${summary}`}</title>
      <path d={area} fill={color} opacity={0.1} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(last)} cy={y(values[last])} r={4} fill={color} stroke="var(--card)" strokeWidth={2} />
    </svg>
  );
}
