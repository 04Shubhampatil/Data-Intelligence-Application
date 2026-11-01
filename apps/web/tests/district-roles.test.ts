import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLE_NAMES, validateDistrictAssignment } from "@di/db/permissions";

describe("district roles", () => {
  it("defines five roles and Super Admin has every permission", () => {
    expect(ROLE_NAMES).toEqual(["SUPER_ADMIN", "ADMIN", "DISTRICT_ADMIN", "DISTRICT_VIEWER", "VIEWER"]);
    expect([...DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN].sort()).toEqual([...PERMISSIONS].sort());
  });

  it("district roles cannot run syncs, manage all users, or change settings by default", () => {
    for (const role of ["DISTRICT_ADMIN", "DISTRICT_VIEWER"] as const) {
      for (const p of ["sync:run", "users:manage", "settings:write", "districts:assign", "audit:read"] as const) {
        expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain(p);
      }
    }
  });

  it("only humans with reviews:decide can decide; Viewer cannot", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.VIEWER).not.toContain("reviews:decide");
    expect(DEFAULT_ROLE_PERMISSIONS.DISTRICT_VIEWER).toContain("reviews:decide");
    expect(DEFAULT_ROLE_PERMISSIONS.DISTRICT_ADMIN).not.toContain("reviews:override"); // grantable, off by default
  });

  it("district assignment rules", () => {
    expect(validateDistrictAssignment("DISTRICT_VIEWER", 0)).toMatch(/exactly one/);
    expect(validateDistrictAssignment("DISTRICT_VIEWER", 2)).toMatch(/only one/);
    expect(validateDistrictAssignment("DISTRICT_VIEWER", 1)).toBeNull();
    expect(validateDistrictAssignment("DISTRICT_ADMIN", 0)).toMatch(/at least one/);
    expect(validateDistrictAssignment("DISTRICT_ADMIN", 3)).toBeNull();
    expect(validateDistrictAssignment("SUPER_ADMIN", 1)).toMatch(/global/);
    expect(validateDistrictAssignment("ADMIN", 1)).toMatch(/global/);
    expect(validateDistrictAssignment("VIEWER", 0)).toBeNull();
    expect(validateDistrictAssignment("VIEWER", 2)).toBeNull();
  });
});
