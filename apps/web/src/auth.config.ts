import type { NextAuthConfig } from "next-auth";
import type { Permission } from "@di/db/permissions";

const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password"];

export function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Edge/proxy-safe config: no DB, no bcrypt. Used by proxy.ts for the
 * optimistic redirect only. Real authorization happens server-side in
 * src/server/auth/session.ts, close to the data.
 */
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 }, // 8h working day
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      if (pathname.startsWith("/api/auth") || pathname === "/api/health") return true; // health check must stay public
      const signedIn = !!auth?.user;
      if (isPublicPath(pathname)) {
        return signedIn ? Response.redirect(new URL("/", request.nextUrl)) : true;
      }
      // API callers get a JSON 401, not a redirect to the HTML login page.
      if (!signedIn && pathname.startsWith("/api/")) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return signedIn; // false → redirect to pages.signIn with callbackUrl
    },
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.role = user.role;
        token.permissions = user.permissions;
      }
      return token;
    },
    session({ session, token }) {
      if (token.uid) {
        session.user.id = token.uid as string;
        session.user.role = token.role as string;
        session.user.permissions = (token.permissions ?? []) as Permission[];
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
