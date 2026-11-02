import { z } from "zod";

const name = (max = 120) => z.string().trim().min(1).max(max);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const AI_REVIEW_STATUSES = ["PENDING_REVIEW", "SELECTED", "REJECTED", "AWAITING_CONFIRMATION"] as const;

/**
 * Filters the assistant may use. By NAME (what the model sees), never by database id.
 * Everything here is an approved, non-sensitive field.
 */
export const aiFilterSchema = z
  .object({
    district: name(60).optional().describe("District name, e.g. KOLHAPUR"),
    project: name().optional().describe("Department/Project name, e.g. PRADHAN MANTRI AWAS YOJANA (PMAY)"),
    department: name().optional().describe("Department name"),
    subProject: name().optional().describe("Sub-project name"),
    designation: name().optional().describe("Designation, e.g. RURAL HOUSING ENGINEER (CONSULTANT)"),
    employeeType: name(60).optional().describe("Type of employee: Employee, Contractual, Payroll…"),
    gender: z.enum(["Male", "Female", "Other"]).optional(),
    educationType: name(60).optional(),
    nameContains: name(80).optional().describe("Part of the candidate's name"),
    reviewStatus: z
      .enum(AI_REVIEW_STATUSES)
      .optional()
      .describe("Current review decision: PENDING_REVIEW (not yet decided), SELECTED, REJECTED, or AWAITING_CONFIRMATION (a District Viewer decision a District Admin has not confirmed yet)"),
    reviewedBy: name(80).optional().describe("Name or email of the person who recorded a decision on the candidate"),
    reviewedFrom: day.optional().describe("Latest decision on or after this date (YYYY-MM-DD, India time)"),
    reviewedTo: day.optional().describe("Latest decision on or before this date (YYYY-MM-DD, India time)"),
  })
  .strict();

export type AiFilters = z.infer<typeof aiFilterSchema>;

export const GROUP_BY = ["district", "project", "department", "subProject", "designation", "employeeType", "gender", "docVerificationStatus", "sourceStatus", "reviewStatus"] as const;
export type GroupBy = (typeof GROUP_BY)[number];

export const REVIEW_GROUP_BY = ["decision", "reviewer", "district"] as const;

export const toolSchemas = {
  search_candidates: z
    .object({
      filters: aiFilterSchema.default({}),
      limit: z.number().int().min(1).max(100).default(25).describe("Rows to return (max 100)"),
    })
    .strict()
    .describe("Find candidate records matching filters (including review status / reviewer / review date). Returns a table and a result id that can be exported to Excel."),

  count_candidates: z
    .object({
      filters: aiFilterSchema.default({}),
      groupBy: z.enum(GROUP_BY).optional().describe("Group the count by this field (reviewStatus = current decision)"),
    })
    .strict()
    .describe("Count candidates matching filters, optionally grouped (e.g. count by district, or by reviewStatus for selected/rejected/pending)."),

  get_candidate_details: z
    .object({
      employeeCode: z.string().trim().regex(/^[A-Za-z]{1,4}\d{1,10}$/).optional().describe("Employee code like E8825"),
      nameContains: name(80).optional(),
    })
    .strict()
    .refine((v) => v.employeeCode || v.nameContains, { message: "Give an employee code or part of a name" })
    .describe("Details of one candidate by employee code or name, including the current review status."),

  generate_candidate_report: z
    .object({
      filters: aiFilterSchema.default({}),
      groupBy: z.enum(GROUP_BY).optional().describe("Breakdown to include"),
      title: z.string().trim().min(3).max(80).default("Candidate report"),
    })
    .strict()
    .describe("Prepare a report (summary + full row set) that the user can download as Excel."),

  get_sync_status: z.object({}).strict().describe("Latest data synchronization status and record totals."),

  list_filter_values: z
    .object({
      kind: z.enum(["district", "project", "department", "subProject", "designation", "employeeType", "educationType"]),
      contains: name(60).optional().describe("Narrow the list to values containing this text"),
    })
    .strict()
    .describe("Look up the exact names available for a filter (use when a user's wording may not match, e.g. 'PMAY')."),

  count_reviews: z
    .object({
      decision: z.enum(["SELECTED", "REJECTED"]).optional().describe("Only this kind of decision"),
      reviewedBy: name(80).optional().describe("Name or email of the reviewer"),
      district: name(60).optional().describe("District name"),
      from: day.optional().describe("Decisions on or after this date (YYYY-MM-DD, India time)"),
      to: day.optional().describe("Decisions on or before this date (YYYY-MM-DD, India time)"),
      groupBy: z.enum(REVIEW_GROUP_BY).optional().describe("Breakdown: decision, reviewer or district"),
    })
    .strict()
    .describe("Count review DECISIONS that were recorded (every decision, including changed ones), e.g. 'how many rejections did Priya record this week'. Read-only."),

  get_review_history: z
    .object({
      employeeCode: z.string().trim().regex(/^[A-Za-z]{1,4}\d{1,10}$/).describe("Employee code like E8825"),
    })
    .strict()
    .describe("Full review history of one candidate: every decision (who, when, remark, confirmation, overrides) and review comments. Read-only."),
} as const;

export type ToolName = keyof typeof toolSchemas;
export const TOOL_NAMES = Object.keys(toolSchemas) as ToolName[];
/** `filter_candidates` from the spec is the same operation as search; accept it as an alias. */
export const TOOL_ALIASES: Record<string, ToolName> = { filter_candidates: "search_candidates" };
/** Tools that read review data; offered only to users with reviews:read. */
export const REVIEW_TOOLS: readonly ToolName[] = ["count_reviews", "get_review_history"];
