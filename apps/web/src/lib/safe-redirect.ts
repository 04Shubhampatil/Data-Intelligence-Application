import { stripBase, withBase } from "./base-path";

/**
 * Only allow same-origin relative paths as post-login redirect targets,
 * preventing open redirects like `?callbackUrl=https://evil.example`.
 * The result carries the app's path prefix (if any): Auth.js resolves "/x" against
 * the bare origin, so "/candidates" must become "/resourcedata/candidates".
 */
export function safeCallbackUrl(value: unknown, fallback = "/"): string {
  return withBase(checkedPath(value, fallback));
}

/** The validated in-app path, without the base-path prefix. */
function checkedPath(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return fallback;
  let path = value;
  // Auth.js may hand us an absolute URL for our own origin; keep only path+query.
  if (/^https?:\/\//i.test(path)) {
    try {
      const u = new URL(path);
      const own = process.env.AUTH_URL ? new URL(process.env.AUTH_URL).origin : null;
      if (!own || u.origin !== own) return fallback;
      path = u.pathname + u.search;
    } catch {
      return fallback;
    }
  }
  path = stripBase(path);
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return fallback;
  if (path.startsWith("/login") || path.startsWith("/api/auth")) return fallback;
  return path;
}
