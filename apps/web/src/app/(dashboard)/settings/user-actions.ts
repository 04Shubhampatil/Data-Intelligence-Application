"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, isRoleName, validateDistrictAssignment, ROLE_LABELS, type RoleName } from "@di/db";
import { requireUser, type CurrentUser } from "@/server/auth/session";
import { audit } from "@/server/security/audit";
import { hasPermission } from "@/lib/rbac";
import { passwordPolicy } from "@/lib/validation/auth";

export type UserActionState = { ok?: boolean; error?: string; message?: string } | undefined;

const id = z.string().regex(/^[a-z0-9]{1,40}$/i);
const email = z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address"));
const districtIds = z.preprocess((v) => (typeof v === "string" ? v.split(",").filter(Boolean) : []), z.array(id).max(50));

/** Who may manage whom. Super Admin: everyone except other Super Admins and themself. District Admin (with permission): District Viewers in own districts. */
async function actorForUserManagement(): Promise<CurrentUser> {
  const user = await requireUser();
  if (hasPermission(user.permissions, "users:manage") || hasPermission(user.permissions, "users:manage_district")) return user;
  const { redirect } = await import("next/navigation");
  redirect("/403");
  throw new Error("unreachable");
}

function assignableRoles(actor: CurrentUser): RoleName[] {
  if (hasPermission(actor.permissions, "users:manage")) return ["ADMIN", "DISTRICT_ADMIN", "DISTRICT_VIEWER", "VIEWER"];
  if (hasPermission(actor.permissions, "users:manage_district")) return ["DISTRICT_VIEWER"];
  return [];
}

/** Districts the actor may assign: all for `districts:assign`, else only the actor's own. */
function allowedDistricts(actor: CurrentUser, requested: string[]): string | null {
  if (hasPermission(actor.permissions, "districts:assign")) return null;
  const outside = requested.filter((d) => !actor.districtScopeIds.includes(d));
  return outside.length ? "You can only assign districts you are assigned to yourself." : null;
}

/** Guards shared by every change: not yourself, not a Super Admin, and within the actor's reach. */
async function editableTarget(actor: CurrentUser, userId: string) {
  const target = await prisma.user.findUnique({ where: { id: userId }, include: { role: true, districtAssignments: true } });
  if (!target) return { error: "User not found." } as const;
  if (target.id === actor.id) return { error: "You can't change your own account here." } as const;
  if (target.role.name === "SUPER_ADMIN") return { error: "Super Admin accounts can't be changed from this screen." } as const;
  if (!hasPermission(actor.permissions, "users:manage")) {
    const inReach = target.role.name === "DISTRICT_VIEWER" && target.districtAssignments.every((a) => actor.districtScopeIds.includes(a.districtId));
    if (!inReach) return { error: "You can only manage District Viewers in your own districts." } as const;
  }
  return { target } as const;
}

const createSchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(80),
  email,
  password: passwordPolicy,
  role: z.string(),
  districtIds,
});

export async function createUserAction(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  const actor = await actorForUserManagement();
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const { name, email: mail, password, role, districtIds: dIds } = parsed.data;

  if (!isRoleName(role) || !assignableRoles(actor).includes(role)) return { error: "You can't assign that role." };
  const ruleError = validateDistrictAssignment(role, dIds.length);
  if (ruleError) return { error: ruleError };
  const reachError = allowedDistricts(actor, dIds);
  if (reachError) return { error: reachError };
  if (await prisma.user.findUnique({ where: { email: mail } })) return { error: "A user with this email already exists." };
  const roleRow = await prisma.role.findUnique({ where: { name: role } });
  if (!roleRow) return { error: "Role not found." };
  if (dIds.length && (await prisma.district.count({ where: { id: { in: dIds } } })) !== dIds.length) return { error: "Unknown district." };

  const user = await prisma.user.create({
    data: {
      name, email: mail, passwordHash: await bcrypt.hash(password, 12), roleId: roleRow.id,
      districtAssignments: { create: dIds.map((districtId) => ({ districtId, assignedById: actor.id })) },
    },
  });
  await audit("USER_CREATE", { userId: actor.id, target: user.id, metadata: { role, districts: dIds.length } });
  revalidatePath("/settings");
  return { ok: true, message: `${name} created as ${ROLE_LABELS[role]}. Share the password with them securely.` };
}

export async function setUserRoleAction(userId: string, role: string): Promise<UserActionState> {
  const actor = await actorForUserManagement();
  const uid = id.parse(userId);
  if (!isRoleName(role) || !assignableRoles(actor).includes(role)) return { error: "You can't assign that role." };
  const t = await editableTarget(actor, uid);
  if ("error" in t) return { error: t.error };
  const ruleError = validateDistrictAssignment(role, t.target.districtAssignments.length);
  if (ruleError) return { error: `${ruleError} Set the districts first.` };
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  await prisma.user.update({ where: { id: uid }, data: { roleId: roleRow.id } });
  await audit("USER_UPDATE", { userId: actor.id, target: uid, metadata: { role } });
  revalidatePath("/settings");
  return { ok: true, message: "Role updated." };
}

export async function setUserDistrictsAction(userId: string, districts: string[]): Promise<UserActionState> {
  const actor = await actorForUserManagement();
  const uid = id.parse(userId);
  const dIds = z.array(id).max(50).parse(districts);
  const t = await editableTarget(actor, uid);
  if ("error" in t) return { error: t.error };
  const role = t.target.role.name;
  const ruleError = isRoleName(role) ? validateDistrictAssignment(role, dIds.length) : "Unknown role";
  if (ruleError) return { error: ruleError };
  const reachError = allowedDistricts(actor, dIds);
  if (reachError) return { error: reachError };
  if (dIds.length && (await prisma.district.count({ where: { id: { in: dIds } } })) !== dIds.length) return { error: "Unknown district." };

  await prisma.$transaction([
    prisma.userDistrictAssignment.deleteMany({ where: { userId: uid, districtId: { notIn: dIds } } }),
    ...dIds.map((districtId) =>
      prisma.userDistrictAssignment.upsert({
        where: { userId_districtId: { userId: uid, districtId } },
        update: {},
        create: { userId: uid, districtId, assignedById: actor.id },
      }),
    ),
  ]);
  await audit("USER_UPDATE", { userId: actor.id, target: uid, metadata: { districts: dIds.length } });
  revalidatePath("/settings");
  return { ok: true, message: "District assignment updated." };
}

export async function setUserActiveAction(userId: string, isActive: boolean): Promise<UserActionState> {
  const actor = await actorForUserManagement();
  const uid = id.parse(userId);
  const t = await editableTarget(actor, uid);
  if ("error" in t) return { error: t.error };
  await prisma.user.update({ where: { id: uid }, data: { isActive, failedLogins: 0, lockedUntil: null } });
  await audit("USER_UPDATE", { userId: actor.id, target: uid, metadata: { isActive } });
  revalidatePath("/settings");
  return { ok: true, message: isActive ? "User enabled." : "User disabled. Their next request will be signed out." };
}

const resetSchema = z.object({ userId: id, password: passwordPolicy });

export async function resetUserPasswordAction(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  const actor = await actorForUserManagement();
  const parsed = resetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the password." };
  const t = await editableTarget(actor, parsed.data.userId);
  if ("error" in t) return { error: t.error };
  await prisma.user.update({
    where: { id: parsed.data.userId },
    data: { passwordHash: await bcrypt.hash(parsed.data.password, 12), failedLogins: 0, lockedUntil: null },
  });
  await prisma.passwordResetToken.updateMany({ where: { userId: parsed.data.userId, usedAt: null }, data: { usedAt: new Date() } });
  await audit("USER_UPDATE", { userId: actor.id, target: parsed.data.userId, metadata: { passwordReset: true } });
  revalidatePath("/settings");
  return { ok: true, message: "Password updated." };
}

// ───────────── Roles & permissions (Super Admin) ─────────────

export async function setRolePermissionAction(roleName: string, permission: string, enabled: boolean): Promise<UserActionState> {
  const actor = await requireUser("users:manage");
  if (!isRoleName(roleName) || roleName === "SUPER_ADMIN") return { error: "Super Admin permissions can't be changed." };
  const { isPermission, parsePermissions } = await import("@di/db");
  if (!isPermission(permission)) return { error: "Unknown permission." };
  const { isReservedFor } = await import("@di/db/permissions");
  if (enabled && isReservedFor(roleName, permission)) return { error: "That permission is reserved: decisions for the Super Admin and District Admins, confirmations and review comments for the Super Admin." };
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  const current = new Set(parsePermissions(role.permissions));
  if (enabled) current.add(permission);
  else current.delete(permission);
  await prisma.role.update({ where: { id: role.id }, data: { permissions: [...current] } });
  await audit("SETTINGS_UPDATE", { userId: actor.id, target: `role:${roleName}`, metadata: { permission, enabled } });
  revalidatePath("/settings");
  return { ok: true, message: `${ROLE_LABELS[roleName]}: ${permission} ${enabled ? "granted" : "removed"}. Takes effect on users' next request.` };
}
