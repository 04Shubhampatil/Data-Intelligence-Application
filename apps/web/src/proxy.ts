import type { NextFetchEvent, NextRequest } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Optimistic check only (JWT cookie present & valid). Every page and route
// handler re-verifies the user and permissions via src/server/auth/session.ts.
const { auth } = NextAuth(authConfig);
const authProxy = auth as unknown as (req: NextRequest, ev: NextFetchEvent) => Promise<Response | undefined>;

export default function proxy(req: NextRequest, ev: NextFetchEvent) {
  return authProxy(req, ev);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
