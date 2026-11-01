import { z } from "zod";

const filterValue = z.object({ value: z.string().regex(/^\d{1,10}$/), label: z.string().max(120) });

/**
 * What a sync job should do. Stored on SyncJob.filters; validated on both sides
 * (web when queuing, worker when running).
 */
export const syncOptionsSchema = z.object({
  kind: z.enum(["full", "filtered", "retry", "one"]),
  filters: z
    .object({ district: filterValue.optional(), departmentHead: filterValue.optional() })
    .default({}),
  /** Read profile pages for profile-only fields (taluka, joining date, status, documents). */
  includeProfiles: z.boolean().default(true),
  /** Re-read a profile only if it was last read more than N days ago (new records always). */
  profileMaxAgeDays: z.number().int().min(0).max(365).default(7),
  /** Safety cap for trial runs; 0 = no cap. */
  maxRecords: z.number().int().min(0).max(100_000).default(0),
  /** For kind=retry/one: the employee codes to (re)process. */
  codes: z.array(z.string().regex(/^[A-Z]{1,4}\d{1,10}$/)).max(5000).default([]),
});

export type SyncOptions = z.infer<typeof syncOptionsSchema>;

export function describeSync(o: SyncOptions): string {
  if (o.kind === "retry") return `Retry ${o.codes.length} failed record(s)`;
  if (o.kind === "one") return `Single record ${o.codes[0] ?? ""}`.trim();
  const parts = [o.filters.district?.label, o.filters.departmentHead?.label].filter(Boolean);
  const scope = parts.length ? parts.join(" · ") : "All records";
  return `${scope}${o.includeProfiles ? "" : " (list only)"}${o.maxRecords ? ` · max ${o.maxRecords}` : ""}`;
}

/** A RUNNING job whose worker hasn't checked in for this long is considered dead and can be resumed. */
export const STALE_JOB_MS = 5 * 60_000;
