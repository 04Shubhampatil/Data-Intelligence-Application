import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived, user-bound links for document downloads. The link alone is not
 * enough: the route also re-checks the session, permissions and district scope.
 */
const TTL_SECONDS = 10 * 60;

function key() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

function mac(docId: string, userId: string, exp: number, inline: boolean) {
  return createHmac("sha256", key()).update(`${docId}|${userId}|${exp}|${inline ? 1 : 0}`).digest("base64url");
}

export function signDocumentUrl(docId: string, userId: string, opts: { inline?: boolean; now?: number } = {}) {
  const exp = Math.floor((opts.now ?? Date.now()) / 1000) + TTL_SECONDS;
  const inline = !!opts.inline;
  const s = mac(docId, userId, exp, inline);
  return `/api/documents/${encodeURIComponent(docId)}?e=${exp}&s=${s}${inline ? "&inline=1" : ""}`;
}

export function verifyDocumentSignature(docId: string, userId: string, exp: string | null, sig: string | null, inline: boolean, now = Date.now()) {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp)) return false;
  if (Number(exp) * 1000 < now) return false;
  const expected = Buffer.from(mac(docId, userId, Number(exp), inline));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
