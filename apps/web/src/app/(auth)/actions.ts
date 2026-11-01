"use server";

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError, CredentialsSignin } from "next-auth";
import { prisma } from "@di/db";
import { signIn, signOut } from "@/auth";
import { forgotPasswordSchema, loginSchema, resetPasswordSchema } from "@/lib/validation/auth";
import { safeCallbackUrl } from "@/lib/safe-redirect";
import { rateLimit } from "@/server/security/rate-limit";
import { audit } from "@/server/security/audit";
import { sendPasswordResetEmail } from "@/server/mail/password-reset";
import { getCurrentUser } from "@/server/auth/session";

export type FormState =
  | { error?: string; fieldErrors?: Record<string, string[] | undefined>; message?: string; email?: string }
  | undefined;

const LOGIN_ERRORS: Record<string, string> = {
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
  locked: "This account is temporarily locked after repeated failed attempts. Try again in 15 minutes.",
};

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").slice(0, 254);
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors, email };

  try {
    await signIn("credentials", {
      ...parsed.data,
      redirectTo: safeCallbackUrl(formData.get("callbackUrl")),
    });
  } catch (err) {
    if (err instanceof CredentialsSignin) {
      return { error: LOGIN_ERRORS[err.code] ?? "Invalid email or password.", email };
    }
    if (err instanceof AuthError) return { error: "Sign-in failed. Please try again.", email };
    throw err; // NEXT_REDIRECT on success
  }
}

export async function logoutAction() {
  const user = await getCurrentUser();
  if (user) await audit("LOGOUT", { userId: user.id });
  await signOut({ redirectTo: "/login" });
}

const GENERIC_RESET_MESSAGE =
  "If an account exists for that email, a reset link has been sent. The link is valid for 30 minutes.";

export async function forgotPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`reset:ip:${ip}`, 5, 15 * 60_000).ok || !rateLimit(`reset:acct:${parsed.data.email}`, 3, 60 * 60_000).ok) {
    return { message: GENERIC_RESET_MESSAGE }; // same response — don't reveal throttling per account
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (user?.isActive) {
    const token = crypto.randomBytes(32).toString("base64url"); // 43 chars
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
    const base = process.env.AUTH_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
    await sendPasswordResetEmail(user.email, `${base}/reset-password/${token}`);
    await audit("PASSWORD_RESET_REQUESTED", { userId: user.id, ip });
  }
  return { message: GENERIC_RESET_MESSAGE };
}

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    const fe = z.flattenError(parsed.error).fieldErrors;
    if (fe.token) return { error: "This reset link is invalid or has expired." };
    return { fieldErrors: fe };
  }

  const tokenHash = crypto.createHash("sha256").update(parsed.data.token).digest("hex");
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return { error: "This reset link is invalid or has expired." };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash, failedLogins: 0, lockedUntil: null } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    // invalidate any other outstanding tokens for this user
    prisma.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null, id: { not: record.id } },
      data: { usedAt: new Date() },
    }),
  ]);
  await audit("PASSWORD_RESET", { userId: record.userId });
  redirect("/login?reset=1");
}
