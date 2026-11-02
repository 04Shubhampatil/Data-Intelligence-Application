/**
 * The complete set of fields the application knows how to store, with the
 * default approval for each. Anything not listed here is never extracted.
 * Defaults mirror docs/PHASE-1-ANALYSIS.md §6: ✅ fields on, ⚠ fields off.
 * Changing a default requires the data owner's sign-off (FieldPolicy table).
 */
export const FIELD_DEFS = {
  sourceEmployeeCode: { label: "Employee code", defaultAllowed: true, required: true },
  fullName: { label: "Full name", defaultAllowed: true, required: true },
  gender: { label: "Gender", defaultAllowed: true },
  employeeType: { label: "Type of employee", defaultAllowed: true },
  departmentHead: { label: "Department / Project", defaultAllowed: true },
  department: { label: "Department", defaultAllowed: true },
  subProject: { label: "Sub-project", defaultAllowed: true },
  designation: { label: "Designation", defaultAllowed: true },
  district: { label: "District", defaultAllowed: true },
  taluka: { label: "Taluka", defaultAllowed: true },
  joiningDate: { label: "Date of joining", defaultAllowed: true },
  /** The Employee ID printed on the profile card (e.g. E03559) — differs from the profile id in the URL. */
  officialEmployeeId: { label: "Employee ID (printed on the profile)", defaultAllowed: true },
  sourceStatus: { label: "Status at source", defaultAllowed: true },
  docVerificationStatus: { label: "Document verification (aggregate)", defaultAllowed: true },
  // ⚠ approval-gated — off until the data owner approves
  mobile: { label: "Mobile number", defaultAllowed: false },
  officialEmail: { label: "Official email", defaultAllowed: false },
  // Profile & employment details (father/husband, DOB, address, education, employment, domicile, nominee…). Stored encrypted.
  personalDetails: { label: "Profile & employment details (encrypted)", defaultAllowed: false },
  // Phase 10 — each needs the data owner's approval; sensitive groups are stored encrypted.
  contactExtra: { label: "WhatsApp & personal email (encrypted)", defaultAllowed: false },
  identityDetails: { label: "Identity numbers — PAN, Voter ID…, Aadhaar last 4 only (encrypted)", defaultAllowed: false },
  bankDetails: { label: "Bank details (encrypted)", defaultAllowed: false },
  epfoDetails: { label: "EPFO / UAN / ESIC (encrypted)", defaultAllowed: false },
  familyDetails: { label: "Family details (encrypted)", defaultAllowed: false },
  categoryDetails: { label: "Religion, caste & disability (encrypted)", defaultAllowed: false },
  salaryDetails: { label: "Previous employers' salary (encrypted)", defaultAllowed: false },
  officeLocation: { label: "Office location (latitude/longitude)", defaultAllowed: false },
  attendance: { label: "Attendance (current month)", defaultAllowed: false },
  tickets: { label: "Support tickets (list only)", defaultAllowed: false },
} as const;

export type FieldKey = keyof typeof FIELD_DEFS;
export const FIELD_KEYS = Object.keys(FIELD_DEFS) as FieldKey[];
export const REQUIRED_FIELDS = FIELD_KEYS.filter((k) => "required" in FIELD_DEFS[k]);

export function defaultAllowedFields(): Set<FieldKey> {
  return new Set(FIELD_KEYS.filter((k) => FIELD_DEFS[k].defaultAllowed));
}

/**
 * Drops every key that is not allow-listed. Required identity fields are
 * always kept (a record can't be stored without them).
 * Unknown keys (anything an adapter returns by mistake) are dropped too.
 */
export function applyAllowList<T extends Record<string, unknown>>(raw: T, allowed: ReadonlySet<FieldKey>): Partial<Record<FieldKey, unknown>> {
  const out: Partial<Record<FieldKey, unknown>> = {};
  for (const key of FIELD_KEYS) {
    if (!(key in raw)) continue;
    if (allowed.has(key) || REQUIRED_FIELDS.includes(key)) out[key] = raw[key];
  }
  return out;
}
