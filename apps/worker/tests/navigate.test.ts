import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { gotoWithRetry, isTransientNavError } from "../src/browser/navigate";

const fakePage = (failures: string[]) => {
  let calls = 0;
  return {
    calls: () => calls,
    page: { goto: async () => { calls++; const f = failures.shift(); if (f) throw new Error(f); return null; } } as unknown as Page,
  };
};
const noSleep = async () => {};

describe("gotoWithRetry", () => {
  it("classifies transient network errors", () => {
    expect(isTransientNavError(new Error("page.goto: net::ERR_CONNECTION_TIMED_OUT at https://x"))).toBe(true);
    expect(isTransientNavError(new Error("page.goto: Timeout 30000ms exceeded."))).toBe(true);
    expect(isTransientNavError(new Error("net::ERR_BLOCKED_BY_CLIENT"))).toBe(false);
  });

  it("retries transient failures and then succeeds", async () => {
    const f = fakePage(["net::ERR_CONNECTION_TIMED_OUT", "Timeout 90000ms exceeded."]);
    const logs: string[] = [];
    await gotoWithRetry(f.page, "https://example.test", { sleep: noSleep, log: (m) => logs.push(m) });
    expect(f.calls()).toBe(3);
    expect(logs).toHaveLength(2);
  });

  it("gives up after the last attempt and never retries non-network errors", async () => {
    const a = fakePage(["net::ERR_CONNECTION_TIMED_OUT", "net::ERR_CONNECTION_TIMED_OUT", "net::ERR_CONNECTION_TIMED_OUT"]);
    await expect(gotoWithRetry(a.page, "https://example.test", { sleep: noSleep })).rejects.toThrow(/TIMED_OUT/);
    expect(a.calls()).toBe(3);
    const b = fakePage(["net::ERR_BLOCKED_BY_CLIENT"]);
    await expect(gotoWithRetry(b.page, "https://example.test", { sleep: noSleep })).rejects.toThrow(/BLOCKED/);
    expect(b.calls()).toBe(1);
  });
});
