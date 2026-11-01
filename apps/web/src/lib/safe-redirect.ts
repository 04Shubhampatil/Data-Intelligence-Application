/**
 * Only allow same-origin relative paths as post-login redirect targets,
 * preventing open redirects like `?callbackUrl=https://evil.example`.
 */
export function safeCallbackUrl(value: unknown, fallback = "/"): string {
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
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return fallback;
  if (path.startsWith("/login") || path.startsWith("/api/auth")) return fallback;
  return path;
}
