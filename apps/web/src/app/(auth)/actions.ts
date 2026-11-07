"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { AuthError, CredentialsSignin } from "next-auth";
import { prisma } from "@di/db";
import { signIn, signOut } from "@/auth";
import { changePasswordSchema, loginSchema } from "@/lib/validation/auth";
import { safeCallbackUrl } from "@/lib/safe-redirect";
import { rateLimit } from "@/server/security/rate-limit";
import { audit } from "@/server/security/audit";
import { getCurrentUser } from "@/server/auth/session";
import { withBase } from "@/lib/base-path";

export type FormState =
  | { ok?: boolean; error?: string; fieldErrors?: Record<string, string[] | undefined>; message?: string; username?: string }
  | undefined;

const LOGIN_ERRORS: Record<string, string> = {
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
  locked: "This account is temporarily locked after repeated failed attempts. Try again in 15 minutes.",
};

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const username = String(formData.get("username") ?? "").slice(0, 50);
  const parsed = loginSchema.safeParse({ username: formData.get("username"), password: formData.get("password") });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors, username };

  try {
    await signIn("credentials", {
      ...parsed.data,
      redirectTo: safeCallbackUrl(formData.get("callbackUrl")),
    });
  } catch (err) {
    if (err instanceof CredentialsSignin) {
      return { error: LOGIN_ERRORS[err.code] ?? "Invalid username or password.", username };
    }
    if (err instanceof AuthError) return { error: "Sign-in failed. Please try again.", username };
    throw err; // NEXT_REDIRECT on success
  }
}

export async function logoutAction() {
  const user = await getCurrentUser();
  if (user) await audit("LOGOUT", { userId: user.id });
  await signOut({ redirectTo: withBase("/login") });
}

/** The signed-in user changes their own password (current password required). */
export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Your session has ended. Sign in again." };
  if (!rateLimit(`pwchange:${user.id}`, 5, 15 * 60_000).ok) return { error: "Too many attempts. Please wait a few minutes and try again." };

  const parsed = changePasswordSchema.safeParse({
    current: formData.get("current"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  if (!row || !(await bcrypt.compare(parsed.data.current, row.passwordHash))) {
    await audit("PASSWORD_CHANGE_FAILED", { userId: user.id });
    return { fieldErrors: { current: ["The current password is not correct"] } };
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(parsed.data.password, 12), failedLogins: 0, lockedUntil: null },
  });
  await audit("PASSWORD_CHANGED", { userId: user.id });
  return { ok: true, message: "Password changed. Use the new password next time you sign in." };
}
