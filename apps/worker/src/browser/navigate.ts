import type { Page, Response } from "playwright";

/**
 * Network errors worth retrying: the source server (or the path to it) intermittently drops the
 * first packets of new connections, so a page load can stall for ~20 s or time out outright
 * (observed 2026-11-01: curl connects in 0.02 s most times, sometimes 3 s; Edge page loads 4–25 s).
 */
const TRANSIENT = /ERR_CONNECTION_TIMED_OUT|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_TIMED_OUT|ERR_NETWORK_CHANGED|ERR_EMPTY_RESPONSE|ERR_ADDRESS_UNREACHABLE|Timeout \d+ms exceeded/i;

export const NAV_TIMEOUT_MS = 90_000;

export function isTransientNavError(err: unknown): boolean {
  return err instanceof Error && TRANSIENT.test(err.message);
}

/**
 * page.goto with a generous timeout and a few retries on transient network errors only.
 * Waits for DOMContentLoaded (the HTML), not every image/script, so one stalled asset can't fail it.
 * Never retries other failures (e.g. a blocked or redirected navigation).
 */
export async function gotoWithRetry(
  page: Page,
  url: string,
  opts: { attempts?: number; timeoutMs?: number; log?: (m: string) => void; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Response | null> {
  const attempts = opts.attempts ?? 3;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 1; ; i++) {
    try {
      return await page.goto(url, { waitUntil: "domcontentloaded", timeout: opts.timeoutMs ?? NAV_TIMEOUT_MS });
    } catch (err) {
      if (i >= attempts || !isTransientNavError(err)) throw err;
      const wait = 5_000 * i;
      opts.log?.(`Network slow or unreachable (${(err as Error).message.split("\n")[0].slice(0, 80)}). Retrying in ${wait / 1000} s (attempt ${i + 1} of ${attempts})…`);
      await sleep(wait);
    }
  }
}
