import { chromium, type Browser, type LaunchOptions } from "playwright";

/**
 * Launches Chromium. Order:
 *  1. PLAYWRIGHT_CHANNEL if set (e.g. "msedge", "chrome"),
 *  2. Playwright's bundled Chromium,
 *  3. the system's Microsoft Edge (always present on Windows 10/11).
 * Each launch uses a fresh, temporary profile — never the user's own browser data.
 */
export async function launchBrowser(opts: LaunchOptions = {}): Promise<Browser> {
  const channel = process.env.PLAYWRIGHT_CHANNEL?.trim();
  if (channel) return chromium.launch({ ...opts, channel });
  try {
    return await chromium.launch(opts);
  } catch (err) {
    if (!(err instanceof Error) || !/Executable doesn't exist/i.test(err.message)) throw err;
    console.warn("Bundled Chromium not installed — using the system Microsoft Edge instead.");
    return chromium.launch({ ...opts, channel: "msedge" });
  }
}
