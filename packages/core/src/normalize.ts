const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

const EMPTY = /^(?:|-+|—|n\/?a|na|null|undefined|not provided|not available)$/i;

/** Trims, collapses whitespace, and maps placeholder strings ("Not Provided", "-") to null. */
export function cleanText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return EMPTY.test(s) ? null : s;
}

/** "DINDE  mashnaji" → "Dinde Mashnaji". Keeps initials/dots, handles hyphens and apostrophes. */
export function toTitleCase(v: unknown): string | null {
  const s = cleanText(v);
  if (!s) return null;
  return s.toLowerCase().replace(/(^|[\s\-'.(])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());
}

/** Lookup labels (districts, projects…) are stored upper-case to match the source's filter options. */
export function toUpperLabel(v: unknown): string | null {
  const s = cleanText(v);
  return s ? s.toUpperCase() : null;
}

function utcDate(y: number, m: number, d: number): Date | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null; // rejects 31 Feb etc.
}

/**
 * Parses the date formats observed on the source ("29 April 2026", "29 Apr 2026")
 * plus ISO and Indian numeric forms ("2026-04-29", "29-04-2026", "29/04/2026").
 * Returns null for anything else — never guesses month/day order for ambiguous US formats.
 */
export function parseSourceDate(v: unknown): Date | null {
  const s = cleanText(v);
  if (!s) return null;
  let m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?,?\s+(\d{4})$/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    return month ? utcDate(+m[3], month, +m[1]) : null;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (m) return utcDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return utcDate(+m[3], +m[2], +m[1]);
  return null;
}

/** Indian mobile → "+91XXXXXXXXXX", or null if it isn't a plausible 10-digit mobile. */
export function normalizeIndianMobile(v: unknown): string | null {
  const s = cleanText(v);
  if (!s) return null;
  const digits = s.replace(/\D/g, "").replace(/^(?:91|0)(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

export function normalizeEmail(v: unknown): string | null {
  const s = cleanText(v)?.toLowerCase() ?? null;
  return s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

/** Source employee codes look like "E8685"; normalise case and whitespace. */
export function normalizeEmployeeCode(v: unknown): string | null {
  const s = cleanText(v)?.toUpperCase().replace(/\s+/g, "") ?? null;
  return s && /^[A-Z]{1,4}\d{1,10}$/.test(s) ? s : null;
}
