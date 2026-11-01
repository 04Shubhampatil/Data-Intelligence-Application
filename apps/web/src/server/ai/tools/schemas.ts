import { z } from "zod";

const name = (max = 120) => z.string().trim().min(1).max(max);

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
  })
  .strict();

export type AiFilters = z.infer<typeof aiFilterSchema>;

export const GROUP_BY = ["district", "project", "department", "subProject", "designation", "employeeType", "gender", "docVerificationStatus", "sourceStatus"] as const;
export type GroupBy = (typeof GROUP_BY)[number];

export const toolSchemas = {
  search_candidates: z
    .object({
      filters: aiFilterSchema.default({}),
      limit: z.number().int().min(1).max(100).default(25).describe("Rows to return (max 100)"),
    })
    .strict()
    .describe("Find candidate records matching filters. Returns a table and a result id that can be exported to Excel."),

  count_candidates: z
    .object({
      filters: aiFilterSchema.default({}),
      groupBy: z.enum(GROUP_BY).optional().describe("Group the count by this field"),
    })
    .strict()
    .describe("Count candidates matching filters, optionally grouped (e.g. count by district)."),

  get_candidate_details: z
    .object({
      employeeCode: z.string().trim().regex(/^[A-Za-z]{1,4}\d{1,10}$/).optional().describe("Employee code like E8825"),
      nameContains: name(80).optional(),
    })
    .strict()
    .refine((v) => v.employeeCode || v.nameContains, { message: "Give an employee code or part of a name" })
    .describe("Details of one candidate by employee code or name."),

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
} as const;

export type ToolName = keyof typeof toolSchemas;
export const TOOL_NAMES = Object.keys(toolSchemas) as ToolName[];
/** `filter_candidates` from the spec is the same operation as search; accept it as an alias. */
export const TOOL_ALIASES: Record<string, ToolName> = { filter_candidates: "search_candidates" };
