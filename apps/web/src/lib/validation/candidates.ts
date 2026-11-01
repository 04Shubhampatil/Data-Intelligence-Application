import { z } from "zod";

const id = z.string().trim().min(1).max(40).regex(/^[a-z0-9]+$/i);
const optionalId = z.preprocess((v) => (v === "" || v === "all" ? undefined : v), id.optional());
const optionalText = (max = 60) =>
  z.preprocess((v) => (v === "" || v === "all" ? undefined : v), z.string().trim().max(max).optional());

/**
 * Filters for the candidate list. Mirrors the source dashboard's filters
 * (district, department/project, sub-project, designation, type, gender,
 * education type, free-text search). Age is intentionally absent: date of
 * birth is not an approved field. Shared with the AI tools in Phase 5.
 */
export const candidateFilterSchema = z.object({
  q: optionalText(80),
  districtId: optionalId,
  departmentHeadId: optionalId,
  departmentId: optionalId,
  subProjectId: optionalId,
  designationId: optionalId,
  employeeType: optionalText(),
  gender: optionalText(20),
  educationType: optionalText(),
  reviewStatus: z.preprocess((v) => (v === "" || v === "all" ? undefined : v), z.enum(["PENDING_REVIEW", "SELECTED", "REJECTED", "AWAITING_CONFIRMATION"]).optional()),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((n) => [10, 25, 50, 100].includes(n))
    .catch(10),
});

export type CandidateFilters = z.infer<typeof candidateFilterSchema>;

/** Accepts Next's searchParams object (string | string[] | undefined values). */
export function parseCandidateFilters(sp: Record<string, string | string[] | undefined>): CandidateFilters {
  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const parsed = candidateFilterSchema.safeParse(flat);
  return parsed.success ? parsed.data : candidateFilterSchema.parse({});
}
