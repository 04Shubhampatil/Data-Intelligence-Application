import type { Permission, RoleName } from "@di/db/permissions";

export function hasPermission(granted: readonly Permission[] | undefined, required: Permission | readonly Permission[]) {
  if (!granted?.length) return false;
  const needed = typeof required === "string" ? [required] : required;
  return needed.every((p) => granted.includes(p));
}

export type NavItem = { href: string; label: string; icon: string; permission: Permission; roles?: readonly RoleName[] };

/** Sidebar entries — filtered per user. Labels follow the reference dashboard where they overlap. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "layout-dashboard", permission: "dashboard:read", roles: ["SUPER_ADMIN", "ADMIN", "VIEWER"] },
  // District-scoped dashboards (design §6). A Super Admin can open the District Admin view to supervise.
  { href: "/district", label: "District Dashboard", icon: "map-pin", permission: "reviews:read", roles: ["DISTRICT_ADMIN", "SUPER_ADMIN"] },
  { href: "/review", label: "My Reviews", icon: "clipboard-check", permission: "reviews:read", roles: ["DISTRICT_VIEWER"] },
  { href: "/candidates", label: "Resource Records", icon: "users", permission: "candidates:read" },
  // Verified users of the admin's own districts (2026-11-02). District Admins only — not shown to the Super Admin.
  { href: "/verified-records", label: "Verified Records", icon: "badge-check", permission: "reviews:read", roles: ["DISTRICT_ADMIN"] },
  { href: "/messages", label: "Messages", icon: "mail", permission: "messages:read", roles: ["DISTRICT_ADMIN", "DISTRICT_VIEWER", "SUPER_ADMIN", "ADMIN"] },
  // AI Assistant menu item removed from the sidebar (2026-11-02); the page itself is unchanged.
  { href: "/sync", label: "Data Synchronization", icon: "refresh-cw", permission: "sync:read" },
  { href: "/reports", label: "Reports", icon: "file-bar-chart", permission: "reports:read" },
  { href: "/settings", label: "Settings", icon: "settings", permission: "settings:read" },
];

export function navFor(granted: readonly Permission[], role?: RoleName | string) {
  return NAV_ITEMS.filter((i) => hasPermission(granted, i.permission) && (!i.roles || (role !== undefined && (i.roles as readonly string[]).includes(role))));
}

/** Roles whose data is always limited to their assigned districts. */
export const DISTRICT_ROLES = ["DISTRICT_ADMIN", "DISTRICT_VIEWER"] as const;
/** Matches no real district: a district role with no assignment sees nothing, never everything. */
export const NO_DISTRICT = "__no_district__";

/** The district scope used for every query. Empty means unrestricted, which only global roles may have. */
export function districtScopeFor(role: string, assignedDistrictIds: readonly string[]): string[] {
  if (assignedDistrictIds.length) return [...assignedDistrictIds];
  return (DISTRICT_ROLES as readonly string[]).includes(role) ? [NO_DISTRICT] : [];
}

/** Roles allowed on each district dashboard (page guards use this together with the permission check). */
export const DISTRICT_DASHBOARD_ROLES = { district: ["DISTRICT_ADMIN", "SUPER_ADMIN"], review: ["DISTRICT_VIEWER", "SUPER_ADMIN"], verified: ["DISTRICT_ADMIN"] } as const;

export function canOpenDashboard(which: keyof typeof DISTRICT_DASHBOARD_ROLES, role: string) {
  return (DISTRICT_DASHBOARD_ROLES[which] as readonly string[]).includes(role);
}

/** Where a user lands after sign-in / on "/": district roles get their own dashboard. */
export function homeFor(role: RoleName | string): string {
  if (role === "DISTRICT_ADMIN") return "/district";
  if (role === "DISTRICT_VIEWER") return "/review";
  return "/";
}
