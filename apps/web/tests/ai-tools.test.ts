import { describe, expect, it } from "vitest";
import { aiFilterSchema, REVIEW_TOOLS, TOOL_ALIASES, TOOL_NAMES, toolSchemas } from "@/server/ai/tools/schemas";

describe("AI tool schemas", () => {
  it("exposes exactly the approved read-only tools (plus the filter alias)", () => {
    expect([...TOOL_NAMES].sort()).toEqual(
      ["count_candidates", "count_reviews", "generate_candidate_report", "get_candidate_details", "get_review_history", "get_sync_status", "list_filter_values", "search_candidates"].sort(),
    );
    expect(TOOL_ALIASES.filter_candidates).toBe("search_candidates");
    expect([...REVIEW_TOOLS].sort()).toEqual(["count_reviews", "get_review_history"]);
  });

  it("has no tool that could record, confirm or override a decision", () => {
    for (const n of TOOL_NAMES) expect(n).not.toMatch(/decide|select_|reject|confirm|override|approve|comment|message|update|delete|create/);
  });

  it("rejects unknown filter keys — the model cannot reach non-approved fields", () => {
    for (const bad of [{ aadhaar: "x" }, { mobile: "9" }, { salary: 1 }, { sql: "select 1" }, { districtId: "abc" }, { reviewedById: "abc" }]) {
      expect(aiFilterSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("validates review filters", () => {
    expect(aiFilterSchema.safeParse({ reviewStatus: "SELECTED", reviewedBy: "Priya", reviewedFrom: "2026-10-01", reviewedTo: "2026-10-31" }).success).toBe(true);
    expect(aiFilterSchema.safeParse({ reviewStatus: "APPROVED" }).success).toBe(false);
    expect(aiFilterSchema.safeParse({ reviewedFrom: "last week" }).success).toBe(false);
    expect(toolSchemas.count_candidates.safeParse({ groupBy: "reviewStatus" }).success).toBe(true);
    expect(toolSchemas.count_reviews.safeParse({ groupBy: "reviewer", decision: "REJECTED", from: "2026-10-01" }).success).toBe(true);
    expect(toolSchemas.count_reviews.safeParse({ groupBy: "remark" }).success).toBe(false);
    expect(toolSchemas.get_review_history.safeParse({ employeeCode: "E8825" }).success).toBe(true);
    expect(toolSchemas.get_review_history.safeParse({ employeeCode: "E8825; drop" }).success).toBe(false);
    expect(toolSchemas.get_review_history.safeParse({}).success).toBe(false);
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
