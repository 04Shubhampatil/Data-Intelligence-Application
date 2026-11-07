import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma, parsePermissions, type Permission } from "@di/db";
import { effectivePermissions } from "@di/db/permissions";
import { auth } from "@/auth";
import { districtScopeFor, hasPermission } from "@/lib/rbac";

export type CurrentUser = {
  id: string;
  username: string;
  name: string | null;
  role: string;
  permissions: Permission[];
  districtScopeIds: string[]; // empty = unrestricted (global roles only; see districtScopeFor)
};

/**
 * Data Access Layer entry point. Verifies the JWT, then re-reads the user and
 * role from the DB so deactivation or role changes take effect immediately.
 * Memoised per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      username: true,
      name: true,
      isActive: true,
      role: { select: { name: true, permissions: true } },
      districtAssignments: { select: { districtId: true } },
    },
  });
  if (!user || !user.isActive) return null;

  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role.name,
    // Super Admin-only permissions (decisions, review comments) are removed for every other role here.
    permissions: effectivePermissions(user.role.name, parsePermissions(user.role.permissions)),
    // A District Admin/Viewer without an assigned district sees no records instead of all districts.
    districtScopeIds: districtScopeFor(user.role.name, user.districtAssignments.map((d) => d.districtId)),
  };
});

/** For pages/server actions: redirects to login, or renders 403. */
export async function requireUser(permission?: Permission | Permission[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  // The proxy only saw a valid cookie; the user is gone or disabled. Clear the session (no redirect loop).
  if (!user) redirect("/session-ended");
  if (permission && !hasPermission(user.permissions, permission)) redirect("/403");
  return user;
}

/** For route handlers: returns a Response instead of throwing navigation errors. */
export async function authorizeApi(
  permission: Permission | Permission[],
): Promise<{ user: CurrentUser; error?: never } | { user?: never; error: Response }> {
  const user = await getCurrentUser();
  if (!user) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!hasPermission(user.permissions, permission)) {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}
