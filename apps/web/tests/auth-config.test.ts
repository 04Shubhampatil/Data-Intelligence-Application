import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Config = typeof import("@/auth.config").authConfig;
type AuthorizedArgs = Parameters<Config["callbacks"]["authorized"]>[0];

/** Loads the auth config with or without a path prefix (NEXT_PUBLIC_BASE_PATH is read at module load). */
async function load(prefix?: string) {
  vi.resetModules();
  if (prefix) process.env.NEXT_PUBLIC_BASE_PATH = prefix;
  else delete process.env.NEXT_PUBLIC_BASE_PATH;
  const { authConfig } = await import("@/auth.config");
  return (method: string, path: string, signedIn: boolean) =>
    authConfig.callbacks.authorized({
      auth: signedIn ? { user: { id: "u1" }, expires: "2099-01-01" } : null,
      request: new NextRequest(`https://example.test${path}`, { method }),
    } as unknown as AuthorizedArgs);
}
const location = (r: unknown) => (r as Response).headers.get("location");

afterEach(() => {
  delete process.env.NEXT_PUBLIC_BASE_PATH;
  vi.resetModules();
});

describe("proxy authorization", () => {
  it("sends a signed-in user who opens /login back home", async () => {
    const run = await load();
    const r = run("GET", "/login", true);
    expect((r as Response).status).toBe(302);
    expect(location(r)).toBe("https://example.test/");
  });

  it("never redirects a login form submission (server action POST)", async () => {
    // A redirect here makes the form fail with "An unexpected response was received from the server".
    const run = await load();
    expect(run("POST", "/login", true)).toBe(true);
    expect(run("POST", "/login", false)).toBe(true);
  });

  it("keeps the other rules", async () => {
    const run = await load();
    expect(run("GET", "/login", false)).toBe(true);
    expect(location(run("GET", "/district?x=1", false))).toBe("https://example.test/login?callbackUrl=%2Fdistrict%3Fx%3D1");
    expect((run("GET", "/api/candidates", false) as Response).status).toBe(401);
    expect(run("GET", "/api/health", false)).toBe(true);
    expect(run("GET", "/district", true)).toBe(true);
  });

  it("under a path prefix (production: brtechnobizz.tech/resourcedata) every rule keeps the prefix", async () => {
    // Auth.js passes the path with the prefix still on it when AUTH_URL is set.
    const run = await load("/resourcedata");
    expect(run("GET", "/resourcedata/api/health", false)).toBe(true);
    expect(run("GET", "/resourcedata/login", false)).toBe(true);
    expect((run("GET", "/resourcedata/api/candidates", false) as Response).status).toBe(401);
    expect(location(run("GET", "/resourcedata/district", false))).toBe("https://example.test/resourcedata/login?callbackUrl=%2Fresourcedata%2Fdistrict");
    expect(location(run("GET", "/resourcedata/login", true))).toBe("https://example.test/resourcedata");
    expect(run("POST", "/resourcedata/login", true)).toBe(true);
    expect(run("GET", "/resourcedata/session-ended", true)).toBe(true);
  });

  it("/session-ended is never redirected (it clears a stale session; prevents a redirect loop)", async () => {
    const run = await load();
    expect(run("GET", "/session-ended", true)).toBe(true);
    expect(run("GET", "/session-ended", false)).toBe(true);
  });
});
