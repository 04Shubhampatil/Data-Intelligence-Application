import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signDocumentUrl, verifyDocumentSignature } from "@/server/documents/signing";

describe("document link signing", () => {
  const prev = process.env.AUTH_SECRET;
  beforeAll(() => {
    process.env.AUTH_SECRET = "test-secret-test-secret-test-secret";
  });
  afterAll(() => {
    process.env.AUTH_SECRET = prev;
  });

  const parse = (url: string) => {
    const u = new URL(url, "http://x");
    return { e: u.searchParams.get("e"), s: u.searchParams.get("s"), inline: u.searchParams.get("inline") === "1" };
  };

  it("verifies its own links and rejects tampering, other users, other docs and expiry", () => {
    const now = Date.UTC(2026, 10, 1, 12, 0, 0);
    const url = signDocumentUrl("doc1", "userA", { inline: true, now });
    const { e, s, inline } = parse(url);
    expect(verifyDocumentSignature("doc1", "userA", e, s, inline, now)).toBe(true);
    expect(verifyDocumentSignature("doc1", "userB", e, s, inline, now)).toBe(false); // link is bound to the user
    expect(verifyDocumentSignature("doc2", "userA", e, s, inline, now)).toBe(false);
    expect(verifyDocumentSignature("doc1", "userA", e, s, !inline, now)).toBe(false); // inline flag is signed too
    expect(verifyDocumentSignature("doc1", "userA", String(Number(e) + 1), s, inline, now)).toBe(false);
    expect(verifyDocumentSignature("doc1", "userA", e, s!.slice(0, -1) + "x", inline, now)).toBe(false);
    expect(verifyDocumentSignature("doc1", "userA", e, s, inline, now + 11 * 60_000)).toBe(false); // 10-minute TTL
    expect(verifyDocumentSignature("doc1", "userA", null, null, inline, now)).toBe(false);
    // Stable within a 5-minute bucket (cacheable previews), and never shorter than the 10-minute TTL.
    const t0 = now + 30_000; // 12:00:30 and 12:03:00 both expire at the 12:15 boundary
    expect(signDocumentUrl("doc1", "userA", { inline: true, now: now + 3 * 60_000 })).toBe(signDocumentUrl("doc1", "userA", { inline: true, now: t0 }));
    const odd = now + 61_000;
    const e2 = Number(new URL(`http://x${signDocumentUrl("doc1", "userA", { now: odd })}`).searchParams.get("e"));
    expect(e2 * 1000 - odd).toBeGreaterThanOrEqual(10 * 60_000);
    expect(e2 * 1000 - odd).toBeLessThanOrEqual(15 * 60_000);
  });
});
