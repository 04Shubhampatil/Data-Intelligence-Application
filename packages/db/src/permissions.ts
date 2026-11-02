/** Every permission the app checks. Stored on Role.permissions as a string[]. */
export const PERMISSIONS = [
  "dashboard:read",
  "candidates:read",
  "candidates:read_contact", // mobile / official email (approval-gated)
  "candidates:read_personal", // profile & employment details (encrypted, approval-gated)
  // Phase 10 — sensitive groups (Super Admin only by default) and operational data
  "candidates:read_identity",
  "candidates:read_bank",
  "candidates:read_epfo",
  "candidates:read_family",
  "candidates:read_category",
  "candidates:read_salary",
  "attendance:read",
  "tickets:read",
  "reports:read",
  "reports:export",
  "assistant:use",
  "sync:read",
  "sync:run",
  "settings:read",
  "settings:write",
  "users:manage",
  "users:manage_district", // District Admin: manage District Viewers in own districts
  "districts:assign",
  "audit:read",
  // Phase 9 — documents & review
  "documents:read",
  "documents:read_identity",
  "reviews:read",
  "reviews:decide",
  "reviews:confirm",
  "reviews:override",
  "comments:write",
  "messages:read",
  "messages:send",
  "messages:reply",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "dashboard:read": "View dashboard",
  "candidates:read": "View candidate records",
  "candidates:read_contact": "See contact fields (mobile, official email)",
  "candidates:read_personal": "See profile & employment details (DOB, address, education, employment, domicile, nominee)",
  "candidates:read_identity": "See identity numbers (PAN, Voter ID…; Aadhaar last 4 only)",
  "candidates:read_bank": "See bank details",
  "candidates:read_epfo": "See EPFO / UAN / ESIC details",
  "candidates:read_family": "See family details",
  "candidates:read_category": "See religion, caste and disability",
  "candidates:read_salary": "See previous employers' salary",
  "attendance:read": "See attendance",
  "tickets:read": "See support tickets",
  "reports:read": "View reports",
  "reports:export": "Export Excel",
  "assistant:use": "Use the AI assistant",
  "sync:read": "View synchronization status",
  "sync:run": "Run and manage syncs",
  "settings:read": "View settings",
  "settings:write": "Change settings",
  "users:manage": "Create and manage all users",
  "users:manage_district": "Manage District Viewers in own districts",
  "districts:assign": "Assign districts to users",
  "audit:read": "View the audit log",
  "documents:read": "View candidate documents (photo, certificates)",
  "documents:read_identity": "View identity documents (if enabled)",
  "reviews:read": "View review decisions and history",
  "reviews:decide": "Select or reject candidates (Super Admin, District Admin in own districts)",
  "reviews:confirm": "Confirm earlier pending decisions (Super Admin only)",
  "reviews:override": "Change an existing decision (District Admins can't change a Super Admin's)",
  "comments:write": "Add internal review comments (Super Admin only)",
  "messages:read": "Read district messages",
  "messages:send": "Send district messages and announcements",
  "messages:reply": "Reply to district messages",
};

export const ROLE_NAMES = ["SUPER_ADMIN", "ADMIN", "DISTRICT_ADMIN", "DISTRICT_VIEWER", "VIEWER"] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

export const ROLE_LABELS: Record<RoleName, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  DISTRICT_ADMIN: "District Admin",
  DISTRICT_VIEWER: "District Viewer",
  VIEWER: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  SUPER_ADMIN: "Full access, all districts, users, settings and audit log",
  ADMIN: "All records and reports, run syncs, decide and confirm reviews",
  DISTRICT_ADMIN: "Assigned districts: full employee profiles, monitor reviews, message viewers, district reports",
  DISTRICT_VIEWER: "One assigned district: review candidates and read messages",
  VIEWER: "Read-only access to records, reports and the assistant",
};

/**
 * Who may select / reject candidates (2026-11-02): the Super Admin everywhere, and the District
 * Admin for candidates in their own districts. Confirming pending decisions and internal review
 * comments stay Super Admin-only. These permissions are stripped from every other role when a
 * session is loaded — whatever the Role row in the database says — and the review service
 * additionally checks the role itself, so neither a permission edit nor a direct API call can
 * hand them to anyone else.
 */
export const DECISION_ROLES = ["SUPER_ADMIN", "DISTRICT_ADMIN"] as const;
export const DECISION_PERMISSIONS = ["reviews:decide", "reviews:override"] as const satisfies readonly Permission[];
export const SUPER_ADMIN_ONLY_PERMISSIONS = ["reviews:confirm", "comments:write"] as const satisfies readonly Permission[];

export function isDecisionRole(role: string): boolean {
  return (DECISION_ROLES as readonly string[]).includes(role);
}

export function isSuperAdminOnly(p: string): boolean {
  return (SUPER_ADMIN_ONLY_PERMISSIONS as readonly string[]).includes(p);
}

/** True when `role` may never hold `p` (used by the session filter and the Roles settings). */
export function isReservedFor(role: string, p: string): boolean {
  if (role === "SUPER_ADMIN") return false;
  if (isSuperAdminOnly(p)) return true;
  return (DECISION_PERMISSIONS as readonly string[]).includes(p) && !isDecisionRole(role);
}

/** The permissions a user actually has: the role's list, minus anything reserved for other roles. */
export function effectivePermissions(role: string, granted: readonly Permission[]): Permission[] {
  // The Super Admin always has every permission, including ones added after its role row was seeded.
  return role === "SUPER_ADMIN" ? [...PERMISSIONS] : granted.filter((p) => !isReservedFor(role, p));
}

/** The full employee profile (contact, personal, sensitive groups, identity documents). */
export const DISTRICT_ADMIN_FULL_PROFILE_PERMISSIONS = [
  "candidates:read_contact",
  "candidates:read_personal",
  "candidates:read_identity",
  "candidates:read_bank",
  "candidates:read_epfo",
  "candidates:read_family",
  "candidates:read_category",
  "candidates:read_salary",
  "documents:read_identity",
] as const satisfies readonly Permission[];

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  // Everyone else can READ decisions, history and comments (within their districts) but not change them.
  ADMIN: [
    "dashboard:read", "candidates:read", "reports:read", "reports:export", "assistant:use", "sync:read", "sync:run", "settings:read",
    "documents:read", "reviews:read", "messages:read", "attendance:read", "tickets:read",
  ],
  DISTRICT_ADMIN: [
    "dashboard:read", "candidates:read", "reports:read", "reports:export", "assistant:use",
    "documents:read", "reviews:read", "messages:read", "messages:send", "attendance:read", "tickets:read",
    // Select / reject candidates in their own districts (2026-11-02); can't change a Super Admin decision.
    "reviews:decide", "reviews:override",
    // Full profile for candidates in their own districts (decision 2026-11-01): same view as the
    // Super Admin, still masked by default with an audited "Show", and never in exports or AI.
    ...DISTRICT_ADMIN_FULL_PROFILE_PERMISSIONS,
    // off by default, grantable: users:manage_district
  ],
  DISTRICT_VIEWER: [
    "dashboard:read", "candidates:read", "assistant:use", "documents:read", "reviews:read", "messages:read", "messages:reply", "attendance:read",
  ],
  VIEWER: ["dashboard:read", "candidates:read", "reports:read", "assistant:use", "documents:read", "reviews:read"],
};

/** District assignment rules per role. */
export const ROLE_DISTRICT_RULES: Record<RoleName, { min: number; max: number | null }> = {
  SUPER_ADMIN: { min: 0, max: 0 }, // always global
  ADMIN: { min: 0, max: 0 },
  DISTRICT_ADMIN: { min: 1, max: null },
  DISTRICT_VIEWER: { min: 1, max: 1 },
  VIEWER: { min: 0, max: null }, // optional narrowing
};

export function isRoleName(v: unknown): v is RoleName {
  return typeof v === "string" && (ROLE_NAMES as readonly string[]).includes(v);
}

/** Returns an error message when a role/district combination is invalid, else null. */
export function validateDistrictAssignment(role: RoleName, districtCount: number): string | null {
  const r = ROLE_DISTRICT_RULES[role];
  if (districtCount < r.min) return role === "DISTRICT_VIEWER" ? "A District Viewer must be assigned exactly one district." : "A District Admin must be assigned at least one district.";
  if (r.max !== null && districtCount > r.max) {
    return r.max === 0 ? `${ROLE_LABELS[role]} accounts are global and cannot be limited to districts.` : "A District Viewer can be assigned only one district.";
  }
  return null;
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && (PERMISSIONS as readonly string[]).includes(value);
}

/** Parses the JSON column defensively — unknown strings are dropped. */
export function parsePermissions(value: unknown): Permission[] {
  return Array.isArray(value) ? value.filter(isPermission) : [];
}
