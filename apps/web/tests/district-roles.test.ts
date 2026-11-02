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

  it("Super Admin and District Admin decide; only the Super Admin comments; everyone else only reads", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN).toContain("reviews:decide");
    expect(DEFAULT_ROLE_PERMISSIONS.DISTRICT_ADMIN).toContain("reviews:decide");
    for (const r of ["ADMIN", "DISTRICT_VIEWER", "VIEWER"] as const) expect(DEFAULT_ROLE_PERMISSIONS[r]).not.toContain("reviews:decide");
    for (const r of ["ADMIN", "DISTRICT_ADMIN", "DISTRICT_VIEWER", "VIEWER"] as const) {
      expect(DEFAULT_ROLE_PERMISSIONS[r]).not.toContain("comments:write");
      expect(DEFAULT_ROLE_PERMISSIONS[r]).toContain("reviews:read");
    }
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
