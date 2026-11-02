import "../env";
import { launchBrowser } from "../browser/launch";
import { gotoWithRetry } from "../browser/navigate";
import { prisma } from "@di/db";
import { getAdapter } from "../adapters";
import { saveSession } from "../browser/session";
import { getSourceConnection } from "./source";

/**
 * Manual, human-in-the-loop login. Opens a visible browser at the source's
 * login page; an authorised admin signs in themselves (including any OTP or
 * CAPTCHA — the tool never solves or bypasses these). As soon as an
 * authenticated page is detected the session is saved ENCRYPTED and the
 * browser closes. No password is ever typed, read or stored by this tool.
 */
const TIMEOUT_MS = 10 * 60_000;

const conn = await getSourceConnection();
const adapter = getAdapter(conn.adapterKey);

console.log(`\nOpening ${conn.baseUrl} …`);
console.log("→ Sign in yourself in the window that opens (complete any OTP).");
console.log("→ Don't click anything else; the window closes automatically once you're signed in.\n");

const browser = await launchBrowser({ headless: false });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  page.on("dialog", (d) => void d.dismiss().catch(() => {}));
  await gotoWithRetry(page, new URL(adapter.loginPath, conn.baseUrl).toString(), { log: (m) => console.log(`  ${m}`) });

  const deadline = Date.now() + TIMEOUT_MS;
  let signedIn = false;
  while (Date.now() < deadline && !page.isClosed()) {
    if (await adapter.isLoggedIn(page).catch(() => false)) {
      signedIn = true;
      break;
    }
    await page.waitForTimeout(2000).catch(() => {});
  }

  if (!signedIn) {
    console.error("Not signed in (timed out or window closed). Nothing was saved.");
    process.exitCode = 1;
  } else {
    const { cookies } = await saveSession(conn.id, context);
    console.log(`Signed in. Session saved encrypted (${cookies} cookies). The window will close now.`);
  }
} finally {
  await browser.close();
  await prisma.$disconnect();
}
