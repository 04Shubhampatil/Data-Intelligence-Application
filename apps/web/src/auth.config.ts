import type { NextAuthConfig } from "next-auth";
import type { Permission } from "@di/db/permissions";
import { BASE_PATH, stripBase, withBase } from "./lib/base-path";

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
  // Auth.js routes are served under the app's path prefix (e.g. /resourcedata/api/auth).
  ...(BASE_PATH ? { basePath: `${BASE_PATH}/api/auth` } : {}),
  // Full path: Auth.js builds this redirect itself from AUTH_URL's origin, which knows nothing of the prefix.
  pages: { signIn: withBase("/login") },
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 }, // 8h working day
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      // With AUTH_URL set, Auth.js hands us a rebuilt request whose path still carries the prefix
      // (e.g. /resourcedata/api/health); without a prefix this is the plain path.
      const pathname = stripBase(request.nextUrl.pathname);
      if (pathname.startsWith("/api/auth") || pathname === "/api/health") return true; // health check must stay public
      const signedIn = !!auth?.user;
      if (isPublicPath(pathname)) {
        // Only page visits are sent home. A form submission (server action POST) must reach the action:
        // redirecting it returns an HTML page and the form fails with "An unexpected response was
        // received from the server" (e.g. a login tab left open while signed in elsewhere).
        const isPageVisit = request.method === "GET" || request.method === "HEAD";
        return signedIn && isPageVisit ? Response.redirect(new URL(withBase("/"), request.nextUrl.origin)) : true;
      }
      // API callers get a JSON 401, not a redirect to the HTML login page.
      if (!signedIn && pathname.startsWith("/api/")) return Response.json({ error: "Unauthorized" }, { status: 401 });
      if (signedIn) return true;
      // Sign-in redirect built here (not by Auth.js), so it always keeps the app's path prefix.
      const login = new URL(withBase("/login"), request.nextUrl.origin);
      login.searchParams.set("callbackUrl", withBase(pathname) + request.nextUrl.search);
      return Response.redirect(login);
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
