/** Dashboard maths: months, cumulative series, monthly activity and trends (pure functions). */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("overview helpers", async () => {
  const { lastMonths, cumulativeByMonth, countByMonth, trendPct, monthlyActivity, monthKey } = await import("@/server/services/overview.service");
  const ist = (s: string) => new Date(`${s}+05:30`);

  it("lists the last N months in India time, oldest first (handles year boundaries)", () => {
    expect(lastMonths(6, ist("2026-11-01T00:30:00"))).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(lastMonths(3, ist("2026-02-10T12:00:00"))).toEqual(["2025-12", "2026-01", "2026-02"]);
    // 31 Oct 23:30 UTC is already 1 Nov in India.
    expect(lastMonths(1, new Date("2026-10-31T23:30:00Z"))).toEqual(["2026-11"]);
  });

  it("builds cumulative and per-month counts", () => {
    const months = ["2026-09", "2026-10", "2026-11"];
    const dates = [ist("2026-08-15T10:00:00"), ist("2026-10-01T10:00:00"), ist("2026-10-20T10:00:00"), ist("2026-11-01T10:00:00")];
    expect(cumulativeByMonth(dates, months)).toEqual([1, 3, 4]);
    expect(countByMonth(dates, months)).toEqual([0, 2, 1]);
  });

  it("splits monthly activity into synced, selected and rejected", () => {
    const months = ["2026-10", "2026-11"];
    const out = monthlyActivity(months, [ist("2026-11-01T09:00:00")], [
      { decision: "SELECTED", createdAt: ist("2026-10-05T09:00:00") },
      { decision: "REJECTED", createdAt: ist("2026-11-02T09:00:00") },
      { decision: "SELECTED", createdAt: ist("2026-11-03T09:00:00") },
    ]);
    expect(out).toEqual([
      { month: "2026-10", synced: 0, selected: 1, rejected: 0 },
      { month: "2026-11", synced: 1, selected: 1, rejected: 1 },
    ]);
  });

  it("trend is null without a base, otherwise one-decimal %", () => {
    expect(trendPct(10, 0)).toBeNull();
    expect(trendPct(112, 100)).toBe(12);
    expect(trendPct(90, 120)).toBe(-25);
    expect(trendPct(5125, 5000)).toBe(2.5);
  });
  it("monthKey matches Intl formatting in India time, including around IST midnight", () => {
    const intl = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" });
    const samples = [
      "2026-10-31T18:29:59.999Z", "2026-10-31T18:30:00.000Z", "2026-12-31T18:29:59Z", "2026-12-31T18:30:00Z",
      "2024-02-29T20:00:00Z", "2026-03-31T18:30:00Z", "2026-11-07T05:00:00Z", "1999-12-31T23:59:59Z",
    ].map((s) => new Date(s));
    for (const d of samples) expect(monthKey(d)).toBe(intl.format(d).slice(0, 7));
  });

  it("stays fast on a full dataset (was ~1 s per Dashboard view)", () => {
    const dates = Array.from({ length: 20_000 }, (_, i) => new Date(Date.UTC(2026, 0, 1) + i * 3_600_000));
    const months = lastMonths(6, new Date("2026-11-07T00:00:00Z"));
    const t0 = performance.now();
    cumulativeByMonth(dates, months);
    countByMonth(dates, months);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
