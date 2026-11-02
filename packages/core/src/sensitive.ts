import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Sensitive profile groups (Phase 10, approved 2026-11-01 with written authorization).
 * Each group: its own FieldPolicy key (approval), its own view permission, one AES-256-GCM
 * blob per candidate (CandidateSensitiveData), never sent to the AI model, never exported.
 *
 * NEVER extracted, in any group: employee portal username/password, the full Aadhaar number
 * (last 4 digits only), the PF nominee's Aadhaar, mother's maiden name, Form 16, payment structure.
 */
const t = (max = 200) => z.string().trim().min(1).max(max).optional();

export const contactExtraSchema = z.object({ whatsapp: t(20), personalEmail: t(120) }).strict();

export const identitySchema = z
  .object({
    aadhaarLast4: z.string().regex(/^\d{4}$/).optional(),
    aadhaarName: t(150),
    pan: z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/).optional(),
    panName: t(150),
    panFatherName: t(150),
    /** Voter ID, passport, driving licence, ration card, residence proof */
    others: z.array(z.object({ document: t(60), number: t(40), nameAsOn: t(150) }).strict()).max(10).default([]),
  })
  .strict();

export const bankSchema = z
  .object({ bank: t(150), branch: t(150), accountHolder: t(150), accountNumber: t(40), ifsc: t(20), upi: t(100) })
  .strict();

export const epfoSchema = z
  .object({
    uan: t(30),
    previousPfNo: t(40),
    previousEmployer: t(200),
    pfExitDate: t(40),
    pfNomineeName: t(150),
    pfNomineeDob: t(40), // the Aadhaar half of "PF Nominee Aadhaar / DOB" is dropped by the parser
    nomineeRelationship: t(60),
    pfDeductionChoice: t(40),
    esicCovered: t(20),
    esicIpNo: t(40),
    previousEsicCode: t(40),
  })
  .strict();

export const familySchema = z
  .object({
    fatherName: t(150),
    fatherDob: t(40),
    fatherOccupation: t(100),
    motherName: t(150),
    motherDob: t(40),
    motherOccupation: t(100),
    spouseName: t(150),
    spouseOccupation: t(100),
    childrenCount: t(10),
    children: z.array(z.object({ name: t(150), dob: t(40), occupation: t(100) }).strict()).max(15).default([]),
    dependants: t(10),
  })
  .strict();

export const categorySchema = z
  .object({ religion: t(60), category: t(80), caste: t(80), subCaste: t(80), casteCertificateIssuedBy: t(150), disability: t(60) })
  .strict();

export const salarySchema = z.object({ previous: z.array(z.object({ employer: t(200), salary: t(40) }).strict()).max(20).default([]) }).strict();

export const SENSITIVE_GROUPS = {
  contactExtra: { label: "Additional contact", fieldKey: "contactExtra", permission: "candidates:read_contact", schema: contactExtraSchema },
  identity: { label: "Identity numbers", fieldKey: "identityDetails", permission: "candidates:read_identity", schema: identitySchema },
  bank: { label: "Bank details", fieldKey: "bankDetails", permission: "candidates:read_bank", schema: bankSchema },
  epfo: { label: "EPFO / ESIC", fieldKey: "epfoDetails", permission: "candidates:read_epfo", schema: epfoSchema },
  family: { label: "Family", fieldKey: "familyDetails", permission: "candidates:read_family", schema: familySchema },
  category: { label: "Religion, caste & disability", fieldKey: "categoryDetails", permission: "candidates:read_category", schema: categorySchema },
  salary: { label: "Previous salary", fieldKey: "salaryDetails", permission: "candidates:read_salary", schema: salarySchema },
} as const;

export type SensitiveGroup = keyof typeof SENSITIVE_GROUPS;
export const SENSITIVE_GROUP_KEYS = Object.keys(SENSITIVE_GROUPS) as SensitiveGroup[];
export type SensitiveData = {
  contactExtra?: z.infer<typeof contactExtraSchema>;
  identity?: z.infer<typeof identitySchema>;
  bank?: z.infer<typeof bankSchema>;
  epfo?: z.infer<typeof epfoSchema>;
  family?: z.infer<typeof familySchema>;
  category?: z.infer<typeof categorySchema>;
  salary?: z.infer<typeof salarySchema>;
};

export const isSensitiveGroup = (v: unknown): v is SensitiveGroup => typeof v === "string" && v in SENSITIVE_GROUPS;

/** True when a parsed group holds nothing worth storing. */
export function isEmptyGroup(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.every(isEmptyGroup);
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).every(isEmptyGroup);
  return v === "";
}

export function groupHash(v: unknown): string {
  const sort = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(sort) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort((x as Record<string, unknown>)[k])])) : x;
  return createHash("sha256").update(JSON.stringify(sort(v))).digest("hex");
}

export const sensitiveAad = (candidateId: string, group: string) => `di-sensitive:${candidateId}:${group}`;

/** Masks an identifier for ordinary views: keeps the last `keep` characters. */
export function maskId(v: string | undefined | null, keep = 4): string {
  if (!v) return "—";
  const s = v.replace(/\s+/g, "");
  return s.length <= keep ? "•".repeat(s.length) : `${"•".repeat(Math.min(8, s.length - keep))}${s.slice(-keep)}`;
}

/** Which fields of each group are identifiers masked by default (revealed only on an audited request). */
export const MASKED_FIELDS: Partial<Record<SensitiveGroup, readonly string[]>> = {
  identity: ["pan", "number"],
  bank: ["accountNumber", "upi"],
  epfo: ["uan", "previousPfNo", "esicIpNo"],
  contactExtra: ["whatsapp"],
};
