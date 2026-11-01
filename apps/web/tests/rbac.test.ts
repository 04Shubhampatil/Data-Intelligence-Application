import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, parsePermissions } from "@di/db/permissions";
import { hasPermission, homeFor, navFor } from "@/lib/rbac";

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
    expect(viewerNav).toEqual(["/", "/candidates", "/assistant", "/reports"]);
    expect(navFor(DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN, "SUPER_ADMIN")).toHaveLength(8);
    // District roles see their own dashboard instead of the global one.
    expect(navFor(DEFAULT_ROLE_PERMISSIONS.DISTRICT_VIEWER, "DISTRICT_VIEWER").map((i) => i.href)).toEqual(["/review", "/candidates", "/messages", "/assistant"]);
    expect(navFor(DEFAULT_ROLE_PERMISSIONS.DISTRICT_ADMIN, "DISTRICT_ADMIN").map((i) => i.href)).toEqual(["/district", "/candidates", "/messages", "/assistant", "/reports"]);
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
});

describe("parsePermissions", () => {
  it("drops unknown and non-string entries from the JSON column", () => {
    expect(parsePermissions(["candidates:read", "root:everything", 42, null])).toEqual(["candidates:read"]);
    expect(parsePermissions("candidates:read")).toEqual([]);
    expect(parsePermissions(null)).toEqual([]);
  });
});
