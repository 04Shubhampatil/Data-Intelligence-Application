import { describe, expect, it } from "vitest";
import { changePasswordSchema, loginSchema, passwordPolicy, usernameSchema } from "@/lib/validation/auth";
import { parseCandidateFilters } from "@/lib/validation/candidates";

describe("loginSchema (username sign-in)", () => {
  it("trims and lower-cases the username, so sign-in is not case-sensitive", () => {
    const r = loginSchema.parse({ username: "  SuperAdmin ", password: "x" });
    expect(r.username).toBe("superadmin");
  });

  it("requires a username and a password", () => {
    expect(loginSchema.safeParse({ username: "", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ username: "superadmin", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ username: null, password: null }).success).toBe(false);
  });
});

describe("usernameSchema (new accounts)", () => {
  it.each([
    ["jalgaon.admin", true],
    ["Buldhana_Viewer-2", true],
    ["ab", false],
    ["super admin", false],
    ["-starts-with-dash", false],
    ["user@example.com", false],
  ])("%s → %s", (name, ok) => {
    expect(usernameSchema.safeParse(name).success).toBe(ok);
  });
});

describe("password policy", () => {
  it.each([
    ["short1A", false],
    ["alllowercase123", false],
    ["ALLUPPERCASE123", false],
    ["NoDigitsHereAtAll", false],
    ["Str0ngEnoughPass", true],
  ])("%s → %s", (pw, ok) => {
    expect(passwordPolicy.safeParse(pw).success).toBe(ok);
  });

  it("change password needs the current one, a matching confirmation, and a different new password", () => {
    const ok = { current: "Old-Passw0rd-1", password: "Str0ngEnoughPass", confirm: "Str0ngEnoughPass" };
    expect(changePasswordSchema.safeParse(ok).success).toBe(true);
    expect(changePasswordSchema.safeParse({ ...ok, confirm: "different" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ ...ok, current: "" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ ...ok, current: "Str0ngEnoughPass" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ ...ok, password: "weak", confirm: "weak" }).success).toBe(false);
  });
});

describe("parseCandidateFilters", () => {
  it("defaults to page 1, size 10", () => {
    expect(parseCandidateFilters({})).toMatchObject({ page: 1, pageSize: 10 });
  });

  it("treats 'all' and empty values as no filter", () => {
    const f = parseCandidateFilters({ districtId: "all", gender: "", q: "" });
    expect(f.districtId).toBeUndefined();
    expect(f.gender).toBeUndefined();
    expect(f.q).toBeUndefined();
  });

  it("falls back on invalid paging instead of failing", () => {
    expect(parseCandidateFilters({ page: "-3", pageSize: "5000" })).toMatchObject({ page: 1, pageSize: 10 });
    expect(parseCandidateFilters({ page: "4", pageSize: "50" })).toMatchObject({ page: 4, pageSize: 50 });
  });

  it("rejects injection-shaped ids by dropping all filters", () => {
    const f = parseCandidateFilters({ districtId: "1' OR '1'='1" });
    expect(f.districtId).toBeUndefined();
  });

  it("uses the first value of repeated params", () => {
    expect(parseCandidateFilters({ q: ["Patil", "x"] }).q).toBe("Patil");
  });
});
