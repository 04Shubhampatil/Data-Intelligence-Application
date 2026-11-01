import { describe, expect, it } from "vitest";
import { aiFilterSchema, TOOL_ALIASES, TOOL_NAMES, toolSchemas } from "@/server/ai/tools/schemas";

describe("AI tool schemas", () => {
  it("exposes exactly the six approved tools (plus the filter alias)", () => {
    expect([...TOOL_NAMES].sort()).toEqual(
      ["count_candidates", "generate_candidate_report", "get_candidate_details", "get_sync_status", "list_filter_values", "search_candidates"].sort(),
    );
    expect(TOOL_ALIASES.filter_candidates).toBe("search_candidates");
  });

  it("rejects unknown filter keys — the model cannot reach non-approved fields", () => {
    for (const bad of [{ aadhaar: "x" }, { mobile: "9" }, { salary: 1 }, { sql: "select 1" }, { districtId: "abc" }]) {
      expect(aiFilterSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("caps result sizes and validates codes", () => {
    expect(toolSchemas.search_candidates.parse({}).limit).toBe(25);
    expect(toolSchemas.search_candidates.safeParse({ limit: 5000 }).success).toBe(false);
    expect(toolSchemas.get_candidate_details.safeParse({ employeeCode: "E8825" }).success).toBe(true);
    expect(toolSchemas.get_candidate_details.safeParse({ employeeCode: "8825 OR 1=1" }).success).toBe(false);
    expect(toolSchemas.get_candidate_details.safeParse({}).success).toBe(false);
    expect(toolSchemas.count_candidates.safeParse({ groupBy: "salary" }).success).toBe(false);
  });
});
