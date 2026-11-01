import "../env";
import { launchBrowser } from "../browser/launch";
import { installGuard } from "../browser/guard";
import { mahahrdAdapter } from "../adapters/mahahrd";
import { DEFAULT_SOURCE } from "./source";

/**
 * Read-only: opens the public login page in a fresh, logged-out browser and
 * prints the form STRUCTURE (field names/types, captcha/OTP hints). Submits nothing.
 */
const browser = await launchBrowser();
try {
  const context = await browser.newContext();
  const stats = await installGuard(context, { ...mahahrdAdapter.guardPolicy(DEFAULT_SOURCE.baseUrl), allowedPostPaths: [] });
  const page = await context.newPage();
  await page.goto(DEFAULT_SOURCE.baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  // If the root page has no form, follow the first same-site link that looks like a login link (GET only).
  const loginLinks = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href], button"))
      .map((a) => ({ text: (a.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40), href: (a as HTMLAnchorElement).href ?? "" }))
      .filter((l) => /log ?in|sign ?in/i.test(l.text + " " + l.href)),
  );
  console.log("login-like links on root:", JSON.stringify(loginLinks.map((l) => ({ text: l.text, path: l.href ? new URL(l.href).pathname : null }))));
  const formsOnRoot = await page.evaluate(() => document.forms.length);
  const target = loginLinks.find((l) => l.href && new URL(l.href).hostname === new URL(DEFAULT_SOURCE.baseUrl).hostname);
  if (!formsOnRoot && target) {
    const loginPolicy = mahahrdAdapter.guardPolicy(DEFAULT_SOURCE.baseUrl);
    const p = new URL(target.href).pathname;
    if (!loginPolicy.allowedDocumentPaths.some((r) => r.test(p))) console.log(`note: ${p} is not in the guard's page allow-list yet`);
    await page.goto(target.href, { waitUntil: "domcontentloaded" }).catch((e) => console.log("navigation blocked/failed:", e.message.split("\n")[0]));
    await page.waitForTimeout(2000);
  }

  const info = await page.evaluate(() => ({
    path: location.pathname,
    title: document.title,
    forms: Array.from(document.forms).map((f) => ({
      action: (() => {
        try {
          return new URL(f.action).pathname;
        } catch {
          return f.getAttribute("action");
        }
      })(),
      method: f.method,
      fields: Array.from(f.elements)
        .filter((e) => (e as HTMLInputElement).name || e.id)
        .map((e) => `${(e as HTMLInputElement).name || "#" + e.id}:${(e as HTMLInputElement).type || e.tagName.toLowerCase()}`),
    })),
    captchaHints: {
      recaptcha: !!document.querySelector('iframe[src*="recaptcha"], .g-recaptcha, [data-sitekey]'),
      imageCaptcha: !!document.querySelector('img[src*="captcha" i], input[name*="captcha" i]'),
      otpField: !!document.querySelector('input[name*="otp" i], input[id*="otp" i]'),
    },
  }));
  console.log(JSON.stringify({ ...info, blockedRequests: stats.blocked.length }, null, 2));
} finally {
  await browser.close();
}
