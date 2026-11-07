"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { encryptSecret, sourceCredentialsAad } from "@di/core";
import { prisma } from "@di/db";
import { requireUser } from "@/server/auth/session";
import { audit } from "@/server/security/audit";

export type SourceActionState = { ok?: boolean; error?: string; message?: string } | undefined;

const sourceId = z.string().regex(/^[a-z0-9]{1,40}$/i);

/** Saving or removing the source's password is a Super Admin decision (it grants access to the source system). */
async function superAdmin() {
  const user = await requireUser("settings:write");
  if (user.role !== "SUPER_ADMIN") throw new Error("Only the Super Admin can manage the source sign-in.");
  return user;
}

const saveSchema = z.object({
  sourceId,
  username: z.string().trim().min(1, "Enter the MahaHRD username").max(120),
  // Empty = keep the saved password (e.g. when only the username changes).
  password: z.string().max(200).optional().default(""),
});

/**
 * Saves the MahaHRD username and password for automatic sign-in. The password is encrypted (AES-256-GCM,
 * bound to this connection) before it is stored; it is never sent back to any page. A connection test is
 * queued for the worker straight away.
 */
export async function saveSourceCredentialsAction(_prev: SourceActionState, formData: FormData): Promise<SourceActionState> {
  const user = await superAdmin();
  const parsed = saveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const { sourceId: id, username, password } = parsed.data;

  const conn = await prisma.sourceConnection.findUnique({ where: { id }, select: { encryptedSecret: true, name: true } });
  if (!conn) return { error: "Source not found." };
  if (!password && !conn.encryptedSecret) return { error: "Enter the MahaHRD password." };

  await prisma.sourceConnection.update({
    where: { id },
    data: {
      authMode: "CREDENTIALS",
      username,
      ...(password ? { encryptedSecret: encryptSecret(password, undefined, sourceCredentialsAad(id)) } : {}),
      autoLoginError: null,
      loginTestRequestedAt: new Date(),
    },
  });
  await audit("SETTINGS_UPDATE", { userId: user.id, target: `source:${id}`, metadata: { action: "credentials_saved", passwordChanged: !!password } });
  revalidatePath("/settings");
  revalidatePath("/sync");
  return { ok: true, message: `Saved. The worker is now testing the sign-in to ${conn.name}…` };
}

/** Asks the worker to sign in once with the saved credentials and report the result. */
export async function testSourceConnectionAction(id: string): Promise<SourceActionState> {
  const user = await superAdmin();
  const sid = sourceId.parse(id);
  const conn = await prisma.sourceConnection.findUnique({ where: { id: sid }, select: { authMode: true, encryptedSecret: true } });
  if (!conn || conn.authMode !== "CREDENTIALS" || !conn.encryptedSecret) return { error: "Save the MahaHRD username and password first." };
  await prisma.sourceConnection.update({ where: { id: sid }, data: { loginTestRequestedAt: new Date() } });
  await audit("SETTINGS_UPDATE", { userId: user.id, target: `source:${sid}`, metadata: { action: "connection_test" } });
  revalidatePath("/settings");
  return { ok: true, message: "Test requested — the result appears here in a few seconds." };
}

/** Deletes the saved password and returns to manual sign-in. */
export async function removeSourceCredentialsAction(id: string): Promise<SourceActionState> {
  const user = await superAdmin();
  const sid = sourceId.parse(id);
  await prisma.sourceConnection.update({
    where: { id: sid },
    data: { authMode: "MANUAL_SESSION", username: null, encryptedSecret: null, autoLoginError: null, loginTestRequestedAt: null },
  });
  await audit("SETTINGS_UPDATE", { userId: user.id, target: `source:${sid}`, metadata: { action: "credentials_removed" } });
  revalidatePath("/settings");
  revalidatePath("/sync");
  return { ok: true, message: "Saved password removed. Syncs now need a manual sign-in." };
}
