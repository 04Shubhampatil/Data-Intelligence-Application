/** Parses source dates like "01 June 2015", "1 Jan 2020", "2020-03-31"; anything else → null. */
export function parseLooseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const s = v.trim();
  if (!s || s === "-" || /not provided/i.test(s)) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

const monthsBetween = (a: Date, b: Date) => Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()));

/**
 * Total experience in months: current tenure (since joining) plus previous employers with
 * both dates readable. Overlaps aren't merged (the source rarely has them); unreadable periods are skipped.
 */
export function experienceMonths(joining: Date | null, previous: { fromDate?: string; toDate?: string }[], now = new Date()): { months: number; counted: number } {
  let months = joining ? monthsBetween(joining, now) : 0;
  let counted = joining ? 1 : 0;
  for (const p of previous) {
    const from = parseLooseDate(p.fromDate);
    const to = parseLooseDate(p.toDate);
    if (from && to && to > from) {
      months += monthsBetween(from, to);
      counted++;
    }
  }
  return { months, counted };
}

/** Rough education level for picking the "highest qualification"; unknown courses rank lowest. */
export function educationRank(q: string | undefined): number {
  const s = (q ?? "").toLowerCase();
  if (/ph\.?\s?d|doctor/.test(s)) return 7;
  if (/post\s?grad|master|m\.?\s?(sc|a|com|tech|e|ba|ca|phil)\b|mba|mca|\bpg\b/.test(s)) return 6;
  if (/grad|bachelor|b\.?\s?(sc|a|com|tech|e|ba|ca|ed|pharm)\b|engineer|\bbe\b|degree/.test(s)) return 5;
  if (/diploma|polytechnic|iti/.test(s)) return 4;
  if (/hsc|12th|higher secondary|intermediate/.test(s)) return 3;
  if (/ssc|10th|secondary|matric/.test(s)) return 2;
  return s ? 1 : 0;
}

/** The highest-ranked qualification (ties: the later row). */
export function highestQualification<T extends { qualification?: string }>(rows: T[]): T | undefined {
  return rows.reduce<T | undefined>((best, r) => (!best || educationRank(r.qualification) >= educationRank(best.qualification) ? r : best), undefined);
}

/** "4.5 Years", "8 Months", "<1 Month". */
export function formatExperience(months: number): string {
  if (months < 1) return "<1 Month";
  if (months < 12) return `${months} Month${months === 1 ? "" : "s"}`;
  const years = Math.round((months / 12) * 10) / 10;
  return `${years % 1 === 0 ? years.toFixed(0) : years.toFixed(1)} Year${years === 1 ? "" : "s"}`;
}
