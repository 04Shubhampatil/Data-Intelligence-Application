import { NextRequest } from "next/server";
import { BASE_PATH } from "@/lib/base-path";

/**
 * Under a path prefix (e.g. /resourcedata), Next.js hands the Auth.js route handler the URL WITHOUT the prefix
 * (/api/auth/csrf), while Auth.js is configured for `${BASE_PATH}/api/auth` and answered every direct HTTP
 * call with 400 "UnknownAction" (found in QA, 2026-11-07). Server-action sign-in/out was unaffected because
 * it calls Auth.js internally. The prefix is put back here; without a prefix nothing changes.
 */
export function withBasePath(req: NextRequest, basePath: string = BASE_PATH): NextRequest {
  if (!basePath) return req;
  const url = new URL(req.url);
  if (url.pathname === basePath || url.pathname.startsWith(`${basePath}/`)) return req;
  url.pathname = `${basePath}${url.pathname}`;
  return new NextRequest(url, req);
}
