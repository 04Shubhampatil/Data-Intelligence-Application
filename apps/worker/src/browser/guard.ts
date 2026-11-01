import type { BrowserContext, Request } from "playwright";

/**
 * READ-ONLY GUARD for the source dashboard.
 *
 * Every request the automated browser makes passes through `decideRequest`.
 * The extractor itself never clicks controls, but this guard makes writes
 * impossible even if a page script, a mis-click or an adapter bug tries:
 *
 *  - Only GET is allowed, except explicitly allow-listed read endpoints
 *    (e.g. the DataTables listing, which is a POST that only reads).
 *  - Page navigations are allowed only to allow-listed paths on the source host.
 *  - Any URL matching a write/side-effect pattern (logout, edit, approve,
 *    status, upload, delete, mail, export, payment…) is blocked for every method.
 *  - Other hosts may serve static assets (scripts/styles/fonts/images) only.
 */
export type GuardPolicy = {
  host: string; // e.g. "mahahrd.com"
  allowedPostPaths: RegExp[]; // read-only POST endpoints
  allowedDocumentPaths: RegExp[]; // pages the extractor may open
  deniedPathPattern: RegExp; // blocked for every method and type
};

export type RequestInfo = { method: string; url: string; resourceType: string; isNavigation: boolean };
export type GuardDecision = { allow: true } | { allow: false; reason: string };

const STATIC_TYPES = new Set(["script", "stylesheet", "font", "image", "media"]);

export function decideRequest(req: RequestInfo, policy: GuardPolicy): GuardDecision {
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return { allow: false, reason: "unparseable URL" };
  }
  if (url.protocol === "data:" || url.protocol === "blob:") return { allow: true };
  if (url.protocol !== "https:" && url.protocol !== "http:") return { allow: false, reason: `protocol ${url.protocol}` };

  const method = req.method.toUpperCase();
  const sameHost = url.hostname === policy.host || url.hostname.endsWith(`.${policy.host}`);
  const pathAndQuery = decodeURIComponent(url.pathname + url.search);

  if (!sameHost) {
    if (method === "GET" && STATIC_TYPES.has(req.resourceType)) return { allow: true };
    return { allow: false, reason: `off-host ${req.resourceType} to ${url.hostname}` };
  }

  if (policy.deniedPathPattern.test(pathAndQuery)) return { allow: false, reason: `denied path ${url.pathname}` };

  if (method === "POST") {
    return policy.allowedPostPaths.some((p) => p.test(url.pathname))
      ? { allow: true }
      : { allow: false, reason: `POST ${url.pathname} not allow-listed` };
  }
  if (method !== "GET" && method !== "HEAD") return { allow: false, reason: `method ${method}` };

  if (req.isNavigation || req.resourceType === "document") {
    return policy.allowedDocumentPaths.some((p) => p.test(url.pathname))
      ? { allow: true }
      : { allow: false, reason: `navigation to ${url.pathname} not allow-listed` };
  }
  return { allow: true }; // same-host GET for assets / read XHR
}

export type GuardStats = { allowed: number; blocked: { reason: string; method: string; path: string }[] };

/** Installs the guard on a whole context (covers popups and new pages too). */
export async function installGuard(context: BrowserContext, policy: GuardPolicy): Promise<GuardStats> {
  const stats: GuardStats = { allowed: 0, blocked: [] };
  await context.route("**/*", async (route) => {
    const r: Request = route.request();
    const decision = decideRequest(
      { method: r.method(), url: r.url(), resourceType: r.resourceType(), isNavigation: r.isNavigationRequest() },
      policy,
    );
    if (decision.allow) {
      stats.allowed++;
      return route.continue();
    }
    let path = r.url();
    try {
      path = new URL(r.url()).pathname;
    } catch {}
    stats.blocked.push({ reason: decision.reason, method: r.method(), path });
    return route.abort("blockedbyclient");
  });
  // Never accept confirm()/prompt() dialogs — dismiss them.
  context.on("page", (p) => p.on("dialog", (d) => void d.dismiss().catch(() => {})));
  return stats;
}
