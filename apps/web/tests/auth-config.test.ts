import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { authConfig } from "@/auth.config";

type AuthorizedArgs = Parameters<typeof authConfig.callbacks.authorized>[0];
const run = (method: string, path: string, signedIn: boolean) =>
  authConfig.callbacks.authorized({
    auth: signedIn ? { user: { id: "u1" }, expires: "2099-01-01" } : null,
    request: new NextRequest(`http://localhost:3000${path}`, { method }),
  } as unknown as AuthorizedArgs);

describe("proxy authorization", () => {
  it("sends a signed-in user who opens /login back home", () => {
    const r = run("GET", "/login", true);
    expect(r).toBeInstanceOf(Response);
    expect((r as Response).status).toBe(302);
  });

  it("never redirects a login form submission (server action POST)", () => {
    // A redirect here makes the form fail with "An unexpected response was received from the server".
    expect(run("POST", "/login", true)).toBe(true);
    expect(run("POST", "/login", false)).toBe(true);
  });

  it("keeps the other rules", () => {
    expect(run("GET", "/login", false)).toBe(true);
    expect(run("GET", "/district", false)).toBe(false);
    expect((run("GET", "/api/candidates", false) as Response).status).toBe(401);
    expect(run("GET", "/api/health", false)).toBe(true);
  });
});
