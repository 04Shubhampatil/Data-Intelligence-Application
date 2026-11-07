import { signOut } from "@/auth";
import { withBase } from "@/lib/base-path";

/**
 * Clears a session whose user no longer exists or was disabled, then shows the sign-in page.
 * Without this, such a browser looped between the app (no user → /login) and the proxy
 * (valid cookie → away from /login) until ERR_TOO_MANY_REDIRECTS (found in QA, 2026-11-07).
 */
export async function GET() {
  await signOut({ redirectTo: withBase("/login?ended=1") });
}
