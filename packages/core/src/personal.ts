import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * "Profile & employment" details from the source profile page (approved 2026-11-01).
 *
 * Deliberately NOT part of this shape — never extracted:
 *   portal username/password, Aadhaar number, PAN number, names as on Aadhaar/PAN,
 *   religion, category, caste/sub-caste, caste certificate, mother's maiden name,
 *   disability, salary, EPFO/UAN, bank details, family members' details.
 *
 * Stored encrypted (AES-256-GCM) on CandidateProfile.personalEncrypted; shown only to
 * roles with `candidates:read_personal`; never sent to the AI model or written to exports.
 */
const text = (max = 300) => z.string().trim().min(1).max(max).optional();

export const educationEntrySchema = z
  .object({ qualification: text(150), board: text(200), yearOfPassing: text(20), marks: text(40) })
  .strict();

export const employmentEntrySchema = z
  .object({
    employer: text(200),
    designation: text(150),
    fromDate: text(40),
    toDate: text(40),
    reasonForLeaving: text(300),
    experienceLetterSubmitted: text(20),
    exitProcessed: text(20),
  })
  .strict();

export const nomineeSchema = z.object({ name: text(150), relationship: text(60), dateOfBirth: text(60), mobile: text(20) }).strict();

export const domicileSchema = z
  .object({
    placeOfBirth: text(150),
    nativeDistrict: text(100),
    permanentAddress: text(500),
    durationOfStay: text(60),
    schoolingInState: text(100),
    schoolNameLocation: text(300),
    motherTongue: text(60),
  })
  .strict();

/** Reporting officer as printed on the profile header card (work contact; shown with the contact permission). */
export const reportingOfficerSchema = z.object({ name: text(150), designation: text(150), district: text(100), phone: text(20) }).strict();

export const personalDetailsSchema = z
  .object({
    fatherOrHusbandName: text(150),
    dateOfBirth: text(40),
    address: text(500),
    pincode: z.string().trim().regex(/^\d{6}$/).optional(),
    alternateContact: text(20),
    bloodGroup: text(10),
    maritalStatus: text(30),
    emergencyContactName: text(150),
    emergencyContactNo: text(20),
    reportingOfficer: reportingOfficerSchema.optional(),
    education: z.array(educationEntrySchema).max(20).default([]),
    employment: z.array(employmentEntrySchema).max(20).default([]),
    domicile: domicileSchema.optional(),
    nominees: z.array(nomineeSchema).max(10).default([]),
  })
  .strict();

export type PersonalDetails = z.infer<typeof personalDetailsSchema>;

/** Stable hash (key-sorted JSON) so an unchanged profile is not re-encrypted on every sync. */
export function personalHash(p: PersonalDetails): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v;
  return createHash("sha256").update(JSON.stringify(sort(p))).digest("hex");
}

/** True when nothing worth storing was found (all sections empty). */
export function isEmptyPersonal(p: PersonalDetails): boolean {
  const { education, employment, nominees, ...rest } = p;
  return !education.length && !employment.length && !nominees.length && Object.values(rest).every((v) => v === undefined);
}

/** AAD for the encrypted blob, bound to the candidate so ciphertexts can't be swapped between rows. */
export const personalAad = (candidateId: string) => `di-personal:${candidateId}`;
