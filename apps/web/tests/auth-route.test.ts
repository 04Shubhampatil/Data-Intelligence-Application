import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { withBasePath } from "@/server/auth/auth-route";

describe("Auth.js route under a path prefix", () => {
  it("puts the prefix back when Next.js stripped it (fixes 400 UnknownAction on /resourcedata/api/auth/*)", () => {
    const r = withBasePath(new NextRequest("https://brtechnobizz.tech/api/auth/csrf?x=1", { method: "GET" }), "/resourcedata");
    expect(new URL(r.url).pathname).toBe("/resourcedata/api/auth/csrf");
    expect(new URL(r.url).search).toBe("?x=1");
  });

  it("keeps a URL that already has the prefix, and changes nothing without a prefix", () => {
    const already = new NextRequest("https://brtechnobizz.tech/resourcedata/api/auth/session");
    expect(withBasePath(already, "/resourcedata")).toBe(already);
    const local = new NextRequest("http://localhost:3000/api/auth/session");
    expect(withBasePath(local, "")).toBe(local);
  });

  it("keeps the method and body of a POST", async () => {
    const r = withBasePath(new NextRequest("https://brtechnobizz.tech/api/auth/callback/credentials", { method: "POST", body: "a=1" }), "/resourcedata");
    expect(r.method).toBe("POST");
    expect(await r.text()).toBe("a=1");
  });
});
