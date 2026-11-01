import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma, parsePermissions, type Permission } from "@di/db";
import { auth } from "@/auth";
import { hasPermission } from "@/lib/rbac";

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  permissions: Permission[];
  districtScopeIds: string[]; // empty = unrestricted
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
      email: true,
      name: true,
      isActive: true,
      role: { select: { name: true, permissions: true } },
      districtAssignments: { select: { districtId: true } },
    },
  });
  if (!user || !user.isActive) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role.name,
    permissions: parsePermissions(user.role.permissions),
    districtScopeIds: user.districtAssignments.map((d) => d.districtId),
  };
});

/** For pages/server actions: redirects to login, or renders 403. */
export async function requireUser(permission?: Permission | Permission[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
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
