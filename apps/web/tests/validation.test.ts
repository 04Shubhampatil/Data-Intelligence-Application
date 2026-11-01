import { describe, expect, it } from "vitest";
import { loginSchema, passwordPolicy, resetPasswordSchema } from "@/lib/validation/auth";
import { parseCandidateFilters } from "@/lib/validation/candidates";

describe("loginSchema", () => {
  it("normalises email", () => {
    const r = loginSchema.parse({ email: "  Admin@Example.COM ", password: "x" });
    expect(r.email).toBe("admin@example.com");
  });

  it("rejects bad email and empty password", () => {
    expect(loginSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: null, password: null }).success).toBe(false);
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

  it("reset requires matching confirmation and a well-formed token", () => {
    const token = "a".repeat(43);
    expect(resetPasswordSchema.safeParse({ token, password: "Str0ngEnoughPass", confirm: "Str0ngEnoughPass" }).success).toBe(true);
    expect(resetPasswordSchema.safeParse({ token, password: "Str0ngEnoughPass", confirm: "different" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token: "../../etc", password: "Str0ngEnoughPass", confirm: "Str0ngEnoughPass" }).success).toBe(false);
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
