import { describe, expect, it, vi } from "vitest";

// Pure query-building test: keep Prisma out of it.
vi.mock("@di/db", () => ({ prisma: {} }));

const { buildCandidateWhere } = await import("@/server/services/candidate.service");

describe("buildCandidateWhere", () => {
  it("always excludes records deleted at source", () => {
    expect(buildCandidateWhere({}, [])).toEqual({ AND: [{ isDeletedAtSource: false }] });
  });

  it("always applies the user's district scope, even when a district filter is chosen", () => {
    const where = buildCandidateWhere({ districtId: "d_other" }, ["d1", "d2"]);
    expect(where.AND).toContainEqual({ districtId: { in: ["d1", "d2"] } });
    expect(where.AND).toContainEqual({ districtId: "d_other" }); // AND → empty result, never a scope bypass
  });

  it("searches name (contains) or exact employee code", () => {
    const where = buildCandidateWhere({ q: "e8685" }, []);
    expect(where.AND).toContainEqual({
      OR: [{ fullName: { contains: "e8685" } }, { sourceEmployeeCode: { equals: "E8685" } }],
    });
  });

  it("maps each filter to its column", () => {
    const where = buildCandidateWhere(
      { departmentHeadId: "p", subProjectId: "s", designationId: "g", employeeType: "Payroll", gender: "Female", educationType: "ITI" },
      [],
    );
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { departmentHeadId: "p" },
        { subProjectId: "s" },
        { designationId: "g" },
        { employeeType: "Payroll" },
        { gender: "Female" },
        { educationType: "ITI" },
      ]),
    );
  });
});
