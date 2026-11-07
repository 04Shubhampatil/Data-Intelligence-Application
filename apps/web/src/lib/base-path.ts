/**
 * The app can be served under a path prefix, e.g. https://brtechnobizz.tech/resourcedata
 * (NEXT_PUBLIC_BASE_PATH=/resourcedata, read at build time). Next.js adds the prefix to <Link>,
 * router navigation and redirect() by itself; everything else — fetch(), <a href> downloads,
 * signed document URLs, Auth.js redirect targets — goes through withBase(). Empty locally.
 * Pure: safe in browser and server code.
 */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

/** "/api/x" → "/resourcedata/api/x" (unchanged when there is no prefix or it is already there). */
export function withBase(path: string): string {
  if (!BASE_PATH || !path.startsWith("/") || path.startsWith("//")) return path;
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`) || path.startsWith(`${BASE_PATH}?`)) return path;
  return path === "/" ? BASE_PATH : `${BASE_PATH}${path}`;
}

/** "/resourcedata/candidates" → "/candidates"; paths without the prefix are returned as they are. */
export function stripBase(path: string): string {
  if (!BASE_PATH) return path;
  if (path === BASE_PATH) return "/";
  return path.startsWith(`${BASE_PATH}/`) || path.startsWith(`${BASE_PATH}?`) ? path.slice(BASE_PATH.length) || "/" : path;
}
