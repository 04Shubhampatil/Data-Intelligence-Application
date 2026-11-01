/** Every permission the app checks. Stored on Role.permissions as a string[]. */
export const PERMISSIONS = [
  "dashboard:read",
  "candidates:read",
  "candidates:read_contact", // mobile / official email (approval-gated)
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
  "reviews:decide": "Select or reject candidates",
  "reviews:confirm": "Confirm District Viewer decisions",
  "reviews:override": "Override earlier decisions",
  "comments:write": "Add review comments",
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
  DISTRICT_ADMIN: "Assigned districts: monitor reviews, message viewers, district reports",
  DISTRICT_VIEWER: "One assigned district: review candidates and read messages",
  VIEWER: "Read-only access to records, reports and the assistant",
};

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  ADMIN: [
    "dashboard:read", "candidates:read", "reports:read", "reports:export", "assistant:use", "sync:read", "sync:run", "settings:read",
    "documents:read", "reviews:read", "reviews:decide", "reviews:confirm", "reviews:override", "comments:write", "messages:read",
  ],
  DISTRICT_ADMIN: [
    "dashboard:read", "candidates:read", "reports:read", "reports:export", "assistant:use",
    "documents:read", "reviews:read", "reviews:decide", "comments:write", "messages:read", "messages:send",
    // off by default, grantable: reviews:confirm, reviews:override, users:manage_district, candidates:read_contact
  ],
  DISTRICT_VIEWER: [
    "dashboard:read", "candidates:read", "assistant:use", "documents:read", "reviews:read", "reviews:decide", "comments:write", "messages:read", "messages:reply",
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
