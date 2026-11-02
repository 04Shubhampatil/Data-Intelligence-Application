import { describe, expect, it, vi } from "vitest";

vi.mock("@di/db", () => ({ prisma: {} }));

describe("parallel profile reading", async () => {
  const { runPool, profileConcurrency } = await import("../src/jobs/run-sync");
  const tick = () => new Promise((r) => setTimeout(r, 1));

  it("processes every item once with at most N in flight, each worker on its own slot", async () => {
    let inFlight = 0, peak = 0;
    const seen: number[] = [];
    const workersUsed = new Set<number>();
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n, w) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      workersUsed.add(w);
      await tick();
      seen.push(n);
      inFlight--;
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
    expect([...workersUsed].sort()).toEqual([0, 1, 2]);
  });

  it("stops handing out work once asked to stop", async () => {
    const done: number[] = [];
    let stop = false;
    await runPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      await tick();
      done.push(n);
      if (n === 2) stop = true;
    }, () => stop);
    expect(done.length).toBeLessThan(6);
  });

  it("finishes in-flight items, then rethrows the first error (a lost session stops the job)", async () => {
    const done: number[] = [];
    await expect(
      runPool([1, 2, 3, 4, 5], 2, async (n) => {
        await tick();
        if (n === 1) throw new Error("SESSION_EXPIRED");
        done.push(n);
      }),
    ).rejects.toThrow("SESSION_EXPIRED");
    expect(done).toContain(2); // the other worker's item completed
    expect(done).not.toContain(5);
  });

  it("listing requests are retried on network drops only, with growing pauses", async () => {
    const { retryTransient, isTransientListingError } = await import("../src/jobs/run-sync");
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    let calls = 0;
    const out = await retryTransient(async () => {
      if (++calls < 3) throw new Error("page.evaluate: Error: Listing request failed (HTTP 0)");
      return "rows";
    }, { sleep });
    expect(out).toBe("rows");
    expect(waits).toEqual([5_000, 20_000]);

    calls = 0;
    await expect(retryTransient(async () => { calls++; throw new Error("Source session expired"); }, { sleep })).rejects.toThrow("expired");
    expect(calls).toBe(1); // never retried

    calls = 0;
    await expect(retryTransient(async () => { calls++; throw new Error("HTTP 503"); }, { sleep, delaysMs: [1, 1] })).rejects.toThrow("503");
    expect(calls).toBe(3); // gives up after the last pause

    for (const m of ["HTTP 0", "TypeError: Failed to fetch", "net::ERR_CONNECTION_RESET", "Timeout 30000ms exceeded", "HTTP 429"]) expect(isTransientListingError(new Error(m))).toBe(true);
    for (const m of ["HTTP 403", "HTTP 404", "Layout changed"]) expect(isTransientListingError(new Error(m))).toBe(false);
  });

  it("concurrency defaults to 3, can be lowered to 1, and is capped at 4", () => {
    expect(profileConcurrency(undefined)).toBe(3);
    expect(profileConcurrency("1")).toBe(1);
    expect(profileConcurrency("10")).toBe(4);
    expect(profileConcurrency("abc")).toBe(3);
    expect(profileConcurrency("0")).toBe(3);
  });
});
