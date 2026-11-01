import "server-only";

/**
 * Fixed-window in-memory rate limiter.
 * Good enough for a single Next.js instance; move it to the database or a shared
 * store if the app ever runs more than one replica.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export type RateLimitResult = { ok: boolean; remaining: number; retryAfterMs: number };

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    sweep(now);
    return { ok: true, remaining: limit - 1, retryAfterMs: 0 };
  }
  bucket.count += 1;
  const ok = bucket.count <= limit;
  return { ok, remaining: Math.max(0, limit - bucket.count), retryAfterMs: ok ? 0 : bucket.resetAt - now };
}

let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

/** Test helper. */
export function __resetRateLimits() {
  buckets.clear();
}
