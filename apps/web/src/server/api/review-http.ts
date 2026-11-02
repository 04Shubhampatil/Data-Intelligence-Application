import "server-only";
import { ReviewError } from "@/server/services/review.service";

/** Maps review-service errors to HTTP statuses (no stack traces or internals in the body). */
export function reviewErrorResponse(err: unknown): Response {
  if (err instanceof ReviewError) {
    const status = { FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, INVALID: 400 }[err.code];
    return Response.json({ error: err.message }, { status });
  }
  console.error("[review api]", err instanceof Error ? err.message : err);
  return Response.json({ error: "Something went wrong." }, { status: 500 });
}

/**
 * Cookie-authenticated JSON endpoints: accept only same-origin requests with a JSON body,
 * so another site cannot submit a decision on a signed-in user's behalf (CSRF).
 */
export function rejectCrossSite(request: Request): Response | null {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return Response.json({ error: "Cross-site request refused." }, { status: 403 });
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Send JSON (Content-Type: application/json)." }, { status: 415 });
  }
  return null;
}

export const isId = (v: string) => /^[a-z0-9]{1,40}$/i.test(v);
