import { z } from "zod";

export const scheduleSpecSchema = z.object({
  frequency: z.enum(["HOURLY", "DAILY", "WEEKLY"]),
  minute: z.coerce.number().int().min(0).max(59).default(0),
  hour: z.coerce.number().int().min(0).max(23).default(2),
  weekday: z.coerce.number().int().min(0).max(6).default(1), // 0 = Sunday
});
export type ScheduleSpec = z.infer<typeof scheduleSpecSchema>;

export const DEFAULT_TIME_ZONE = "Asia/Kolkata";
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Wall-clock parts of an instant in a time zone. */
function partsIn(date: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}

/** Offset (ms) of `timeZone` from UTC at `date`. */
function offsetMs(date: Date, timeZone: string) {
  const p = partsIn(date, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant for a wall-clock time in `timeZone` (two-pass to handle offset changes). */
function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = new Date(guess - offsetMs(new Date(guess), timeZone));
  return new Date(guess - offsetMs(first, timeZone));
}

/**
 * Next run strictly after `from`, in the given time zone.
 * HOURLY: every hour at :minute. DAILY: at hour:minute. WEEKLY: on weekday at hour:minute.
 */
export function computeNextRun(spec: ScheduleSpec, from: Date = new Date(), timeZone = DEFAULT_TIME_ZONE): Date {
  const now = partsIn(from, timeZone);
  if (spec.frequency === "HOURLY") {
    let candidate = zonedToUtc(now.y, now.m, now.d, now.h, spec.minute, timeZone);
    while (candidate <= from) candidate = new Date(candidate.getTime() + 3_600_000);
    return candidate;
  }
  for (let add = 0; add <= 8; add++) {
    const day = new Date(Date.UTC(now.y, now.m - 1, now.d + add));
    const candidate = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), spec.hour, spec.minute, timeZone);
    if (candidate <= from) continue;
    if (spec.frequency === "WEEKLY" && partsIn(candidate, timeZone).weekday !== spec.weekday) continue;
    return candidate;
  }
  throw new Error("Could not compute next run"); // unreachable: 8 days always contain the weekday
}

export function describeSchedule(spec: ScheduleSpec): string {
  const hm = `${String(spec.hour).padStart(2, "0")}:${String(spec.minute).padStart(2, "0")}`;
  if (spec.frequency === "HOURLY") return `Every hour at :${String(spec.minute).padStart(2, "0")}`;
  if (spec.frequency === "DAILY") return `Daily at ${hm}`;
  return `Weekly on ${WEEKDAYS[spec.weekday]} at ${hm}`;
}
