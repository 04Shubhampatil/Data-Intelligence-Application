import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { safeCallbackUrl } from "@/lib/safe-redirect";
import { __resetRateLimits, rateLimit } from "@/server/security/rate-limit";

describe("safeCallbackUrl", () => {
  const prev = process.env.AUTH_URL;
  beforeEach(() => {
    process.env.AUTH_URL = "http://localhost:3000";
  });
  afterEach(() => {
    process.env.AUTH_URL = prev;
  });

  it.each([
    ["/candidates?page=2", "/candidates?page=2"],
    ["http://localhost:3000/reports", "/reports"],
    ["https://evil.example/phish", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["javascript:alert(1)", "/"],
    ["/login", "/"],
    [undefined, "/"],
    [42, "/"],
  ])("%s → %s", (input, expected) => {
    expect(safeCallbackUrl(input)).toBe(expected);
  });
});

describe("rateLimit", () => {
  beforeEach(() => __resetRateLimits());

  it("allows up to the limit within a window, then blocks", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) expect(rateLimit("k", 3, 60_000, now).ok).toBe(true);
    const blocked = rateLimit("k", 3, 60_000, now + 1);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after the window and keeps keys independent", () => {
    const now = 2_000_000;
    rateLimit("a", 1, 1000, now);
    expect(rateLimit("a", 1, 1000, now).ok).toBe(false);
    expect(rateLimit("b", 1, 1000, now).ok).toBe(true);
    expect(rateLimit("a", 1, 1000, now + 1001).ok).toBe(true);
  });
});
