import { createHash } from "node:crypto";
import { z } from "zod";
import {
  cleanText,
  normalizeEmail,
  normalizeEmployeeCode,
  normalizeIndianMobile,
  parseSourceDate,
  toTitleCase,
  toUpperLabel,
} from "./normalize";

const text = (max: number) => z.preprocess(cleanText, z.string().max(max).nullable()).optional();
const label = (max = 120) => z.preprocess(toUpperLabel, z.string().max(max).nullable()).optional();

/**
 * Validated, normalised candidate record — the only shape the pipeline will persist.
 * Input is the allow-listed output of an adapter.
 */
export const candidateRecordSchema = z
  .object({
    sourceEmployeeCode: z.preprocess(normalizeEmployeeCode, z.string({ error: "Missing or malformed employee code" })),
    fullName: z.preprocess(toTitleCase, z.string({ error: "Missing name" }).min(2).max(150)),
    gender: z.preprocess(toTitleCase, z.string().max(20).nullable()).optional(), // source uses labels we don't fully control
    employeeType: text(60),
    departmentHead: label(),
    department: label(),
    subProject: label(),
    designation: label(),
    district: label(60),
    taluka: label(60),
    joiningDate: z.preprocess(parseSourceDate, z.date().nullable()).optional(),
    officialEmployeeId: z
      .preprocess((v) => {
        const s = typeof v === "string" ? v.replace(/\s+/g, "").toUpperCase() : "";
        return /^[A-Z]{0,4}\d{1,12}$/.test(s) ? s : null;
      }, z.string().max(20).nullable())
      .optional(),
    sourceStatus: text(40),
    docVerificationStatus: z.enum(["VERIFIED", "PENDING", "REJECTED", "NONE"]).nullable().optional(),
    mobile: z.preprocess(normalizeIndianMobile, z.string().nullable()).optional(),
    officialEmail: z.preprocess(normalizeEmail, z.string().nullable()).optional(),
  })
  .strict();

export type CandidateRecord = z.infer<typeof candidateRecordSchema>;

/**
 * Stable hash of the stored content — identical input ⇒ identical hash, so an
 * unchanged record is detected and skipped on re-sync. Key order and
 * undefined-vs-null differences don't affect it.
 */
export function contentHash(record: CandidateRecord): string {
  const canonical = Object.keys(record)
    .sort()
    .flatMap((k) => {
      const v = record[k as keyof CandidateRecord];
      if (v === null || v === undefined) return []; // missing ≡ null
      return [[k, v instanceof Date ? v.toISOString().slice(0, 10) : v]];
    });
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Aggregates per-document statuses into one value. */
export function aggregateDocStatus(statuses: string[]): CandidateRecord["docVerificationStatus"] {
  const s = statuses.map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!s.length) return "NONE";
  if (s.some((x) => x.startsWith("reject"))) return "REJECTED";
  if (s.every((x) => x === "verified")) return "VERIFIED";
  return "PENDING";
}
