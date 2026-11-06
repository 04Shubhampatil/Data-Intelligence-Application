import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, parsePermissions } from "@di/db/permissions";
import { canOpenDashboard, hasPermission, homeFor, navFor } from "@/lib/rbac";

describe("hasPermission", () => {
  it("requires every listed permission", () => {
    expect(hasPermission(["candidates:read"], "candidates:read")).toBe(true);
    expect(hasPermission(["candidates:read"], ["candidates:read", "reports:export"])).toBe(false);
    expect(hasPermission(["candidates:read", "reports:export"], ["candidates:read", "reports:export"])).toBe(true);
  });

  it("denies when nothing is granted", () => {
    expect(hasPermission([], "dashboard:read")).toBe(false);
    expect(hasPermission(undefined, "dashboard:read")).toBe(false);
  });
});

describe("default roles", () => {
  it("SUPER_ADMIN has every permission", () => {
    expect([...DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN].sort()).toEqual([...PERMISSIONS].sort());
  });

  it("VIEWER cannot run syncs, export, manage users or see contact fields", () => {
    const v = DEFAULT_ROLE_PERMISSIONS.VIEWER;
    for (const p of ["sync:run", "reports:export", "users:manage", "settings:write", "candidates:read_contact"] as const) {
      expect(v).not.toContain(p);
    }
  });

  it("ADMIN cannot manage users or see contact fields", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.ADMIN).not.toContain("users:manage");
    expect(DEFAULT_ROLE_PERMISSIONS.ADMIN).not.toContain("candidates:read_contact");
  });

  it("nav is filtered per role", () => {
    const viewerNav = navFor(DEFAULT_ROLE_PERMISSIONS.VIEWER, "VIEWER").map((i) => i.href);
    expect(viewerNav).toEqual(["/", "/candidates", "/reports"]);
    expect(navFor(DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN, "SUPER_ADMIN")).toHaveLength(7);
    // District roles see their own dashboard instead of the global one.
    expect(navFor(DEFAULT_ROLE_PERMISSIONS.DISTRICT_VIEWER, "DISTRICT_VIEWER").map((i) => i.href)).toEqual(["/review", "/candidates", "/messages"]);
    expect(navFor(DEFAULT_ROLE_PERMISSIONS.DISTRICT_ADMIN, "DISTRICT_ADMIN").map((i) => i.href)).toEqual(["/district", "/candidates", "/verified-records", "/messages", "/reports"]);
  });

  it("district dashboards appear only for district roles (and the Super Admin supervision view)", () => {
    const hrefs = (role: keyof typeof DEFAULT_ROLE_PERMISSIONS) => navFor(DEFAULT_ROLE_PERMISSIONS[role], role).map((i) => i.href);
    expect(hrefs("DISTRICT_ADMIN")).toContain("/district");
    expect(hrefs("DISTRICT_ADMIN")).not.toContain("/review");
    expect(hrefs("DISTRICT_VIEWER")).toContain("/review");
    expect(hrefs("DISTRICT_VIEWER")).not.toContain("/district");
    expect(hrefs("SUPER_ADMIN")).toContain("/district");
    expect(hrefs("ADMIN")).not.toContain("/district");
    expect(hrefs("VIEWER")).not.toContain("/review");
    expect(homeFor("DISTRICT_ADMIN")).toBe("/district");
    expect(homeFor("DISTRICT_VIEWER")).toBe("/review");
    expect(homeFor("ADMIN")).toBe("/");
  });

  it("district dashboards are gated by role, not only by permission", () => {
    expect(canOpenDashboard("district", "DISTRICT_ADMIN")).toBe(true);
    expect(canOpenDashboard("district", "SUPER_ADMIN")).toBe(true);
    for (const r of ["DISTRICT_VIEWER", "VIEWER", "ADMIN"]) expect(canOpenDashboard("district", r)).toBe(false);
    expect(canOpenDashboard("review", "DISTRICT_VIEWER")).toBe(true);
    for (const r of ["DISTRICT_ADMIN", "VIEWER", "ADMIN"]) expect(canOpenDashboard("review", r)).toBe(false);
    // Verified Records: District Admins only, never the Super Admin.
    expect(canOpenDashboard("verified", "DISTRICT_ADMIN")).toBe(true);
    for (const r of ["SUPER_ADMIN", "DISTRICT_VIEWER", "VIEWER", "ADMIN"]) expect(canOpenDashboard("verified", r)).toBe(false);
    expect(navFor(DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN, "SUPER_ADMIN").map((i) => i.href)).not.toContain("/verified-records");
  });
});

describe("parsePermissions", () => {
  it("drops unknown and non-string entries from the JSON column", () => {
    expect(parsePermissions(["candidates:read", "root:everything", 42, null])).toEqual(["candidates:read"]);
    expect(parsePermissions("candidates:read")).toEqual([]);
    expect(parsePermissions(null)).toEqual([]);
  });
});

describe("districtScopeFor", async () => {
  const { districtScopeFor, NO_DISTRICT } = await import("@/lib/rbac");
  it("keeps every District Admin/Viewer inside their own districts", () => {
    expect(districtScopeFor("DISTRICT_ADMIN", ["jalgaon"])).toEqual(["jalgaon"]);
    expect(districtScopeFor("DISTRICT_ADMIN", ["a", "b"])).toEqual(["a", "b"]);
    // No assignment must never mean "all districts" for a district role.
    expect(districtScopeFor("DISTRICT_ADMIN", [])).toEqual([NO_DISTRICT]);
    expect(districtScopeFor("DISTRICT_VIEWER", [])).toEqual([NO_DISTRICT]);
  });
  it("leaves global roles unrestricted", () => {
    for (const r of ["SUPER_ADMIN", "ADMIN", "VIEWER"]) expect(districtScopeFor(r, [])).toEqual([]);
  });
});
