import { afterEach, describe, expect, it, vi } from "vitest";

/** The app served at https://example.test/resourcedata (NEXT_PUBLIC_BASE_PATH is read at module load). */
async function withPrefix(prefix: string | undefined) {
  vi.resetModules();
  if (prefix === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
  else process.env.NEXT_PUBLIC_BASE_PATH = prefix;
  process.env.AUTH_URL = "https://example.test";
  return { ...(await import("@/lib/base-path")), ...(await import("@/lib/safe-redirect")) };
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_BASE_PATH;
  vi.resetModules();
});

describe("base path", () => {
  it("adds and removes the prefix", async () => {
    const { withBase, stripBase } = await withPrefix("/resourcedata/");
    expect(withBase("/api/notifications")).toBe("/resourcedata/api/notifications");
    expect(withBase("/")).toBe("/resourcedata");
    expect(withBase("/resourcedata/candidates")).toBe("/resourcedata/candidates"); // never doubled
    expect(withBase("https://other.test/x")).toBe("https://other.test/x");
    expect(stripBase("/resourcedata/candidates?q=1")).toBe("/candidates?q=1");
    expect(stripBase("/resourcedata")).toBe("/");
    expect(stripBase("/resourcedataX")).toBe("/resourcedataX");
  });

  it("post-login targets keep the prefix and still refuse other sites", async () => {
    const { safeCallbackUrl } = await withPrefix("/resourcedata");
    expect(safeCallbackUrl(undefined)).toBe("/resourcedata");
    expect(safeCallbackUrl("/candidates")).toBe("/resourcedata/candidates");
    expect(safeCallbackUrl("https://example.test/resourcedata/district?x=1")).toBe("/resourcedata/district?x=1");
    expect(safeCallbackUrl("https://evil.test/resourcedata/x")).toBe("/resourcedata");
    expect(safeCallbackUrl("//evil.test")).toBe("/resourcedata");
    expect(safeCallbackUrl("/resourcedata/login")).toBe("/resourcedata");
  });

  it("changes nothing when no prefix is set (local development)", async () => {
    const { withBase, safeCallbackUrl } = await withPrefix(undefined);
    expect(withBase("/api/notifications")).toBe("/api/notifications");
    expect(safeCallbackUrl("/candidates")).toBe("/candidates");
    expect(safeCallbackUrl(undefined)).toBe("/");
  });
});
