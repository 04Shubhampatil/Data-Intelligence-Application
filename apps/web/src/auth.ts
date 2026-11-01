import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { prisma, parsePermissions } from "@di/db";
import { authConfig } from "./auth.config";
import { loginSchema } from "./lib/validation/auth";
import { rateLimit } from "./server/security/rate-limit";
import { audit } from "./server/security/audit";

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

// Compared against when the email is unknown, so response time doesn't reveal which accounts exist.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hash("timing-equalizer", 12));

class RateLimitedError extends CredentialsSignin {
  code = "rate_limited";
}
class LockedError extends CredentialsSignin {
  code = "locked";
}

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        const ip = await clientIp();

        // 10 attempts / 15 min per IP, 5 / 15 min per account.
        if (!rateLimit(`login:ip:${ip}`, 10, 15 * 60_000).ok || !rateLimit(`login:acct:${email}`, 5, 15 * 60_000).ok) {
          throw new RateLimitedError();
        }

        const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });

        if (!user || !user.isActive) {
          await bcrypt.compare(password, await getDummyHash());
          await audit("LOGIN_FAILED", { ip, metadata: { reason: "unknown_or_inactive" } });
          return null;
        }

        if (user.lockedUntil && user.lockedUntil > new Date()) {
          await audit("LOGIN_LOCKED", { userId: user.id, ip });
          throw new LockedError();
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          const failed = user.failedLogins + 1;
          const lock = failed >= MAX_FAILED_LOGINS;
          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLogins: lock ? 0 : failed,
              lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
            },
          });
          await audit("LOGIN_FAILED", { userId: user.id, ip, metadata: { reason: "bad_password", locked: lock } });
          return null;
        }

        await prisma.user.update({
          where: { id: user.id },
          data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
        });
        await audit("LOGIN", { userId: user.id, ip });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role.name,
          permissions: parsePermissions(user.role.permissions),
        };
      },
    }),
  ],
});
