import { describe, expect, it } from "vitest";
import { computeNextRun, describeSchedule, scheduleSpecSchema } from "../src/schedule";

const IST = "Asia/Kolkata";
const at = (iso: string) => new Date(iso);

describe("computeNextRun (Asia/Kolkata)", () => {
  it("hourly: next :15 after 10:20 IST is 11:15 IST", () => {
    // 10:20 IST = 04:50 UTC
    const next = computeNextRun({ frequency: "HOURLY", minute: 15, hour: 0, weekday: 0 }, at("2026-11-01T04:50:00Z"), IST);
    expect(next.toISOString()).toBe("2026-11-01T05:45:00.000Z"); // 11:15 IST
  });

  it("daily: 02:00 IST today if still ahead, otherwise tomorrow", () => {
    const spec = { frequency: "DAILY" as const, minute: 0, hour: 2, weekday: 0 };
    // 00:30 IST on 1 Nov = 19:00 UTC 31 Oct → today 02:00 IST = 20:30 UTC 31 Oct
    expect(computeNextRun(spec, at("2026-10-31T19:00:00Z"), IST).toISOString()).toBe("2026-10-31T20:30:00.000Z");
    // 02:00 IST exactly → strictly after → tomorrow
    expect(computeNextRun(spec, at("2026-10-31T20:30:00Z"), IST).toISOString()).toBe("2026-11-01T20:30:00.000Z");
  });

  it("weekly: Monday 03:30 IST from a Sunday evening and from the Monday itself", () => {
    const spec = { frequency: "WEEKLY" as const, minute: 30, hour: 3, weekday: 1 };
    // Sunday 1 Nov 2026 18:00 IST = 12:30 UTC → Monday 2 Nov 03:30 IST = 1 Nov 22:00 UTC
    expect(computeNextRun(spec, at("2026-11-01T12:30:00Z"), IST).toISOString()).toBe("2026-11-01T22:00:00.000Z");
    // Monday 04:00 IST (after the slot) → next Monday 9 Nov
    expect(computeNextRun(spec, at("2026-11-01T22:30:00Z"), IST).toISOString()).toBe("2026-11-08T22:00:00.000Z");
  });

  it("works for a DST zone too (Europe/London, late October)", () => {
    const spec = { frequency: "DAILY" as const, minute: 0, hour: 9, weekday: 0 };
    // 24 Oct 2026 is BST (UTC+1); 25 Oct clocks go back → 09:00 local = 09:00 UTC
    expect(computeNextRun(spec, at("2026-10-24T10:00:00Z"), "Europe/London").toISOString()).toBe("2026-10-25T09:00:00.000Z");
  });

  it("describe + schema defaults", () => {
    expect(describeSchedule({ frequency: "WEEKLY", minute: 5, hour: 23, weekday: 5 })).toBe("Weekly on Friday at 23:05");
    expect(scheduleSpecSchema.parse({ frequency: "DAILY" })).toEqual({ frequency: "DAILY", minute: 0, hour: 2, weekday: 1 });
    expect(scheduleSpecSchema.safeParse({ frequency: "DAILY", hour: 24 }).success).toBe(false);
  });
});
