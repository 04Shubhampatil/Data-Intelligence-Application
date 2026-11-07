import { decryptSecret, sourceCredentialsAad } from "@di/core";
import { prisma } from "@di/db";
import { getAdapter } from "../adapters";
import { AdapterError } from "../adapters/types";
import { installGuard } from "./guard";
import { launchBrowser } from "./launch";
import { saveSession } from "./session";

export type SourceCredentials = { username: string; password: string };

/** The saved MahaHRD credentials, or null when the connection signs in by hand (MANUAL_SESSION). Worker-only. */
export async function loadCredentials(connectionId: string): Promise<SourceCredentials | null> {
  const c = await prisma.sourceConnection.findUnique({
    where: { id: connectionId },
    select: { authMode: true, username: true, encryptedSecret: true },
  });
  if (!c || c.authMode !== "CREDENTIALS" || !c.username || !c.encryptedSecret) return null;
  return { username: c.username, password: decryptSecret(c.encryptedSecret, undefined, sourceCredentialsAad(connectionId)) };
}

export type AutoLoginResult = { ok: true } | { ok: false; reason: string };

/**
 * Signs in to the source with the saved credentials in a fresh headless browser and stores the new session
 * (encrypted). The read-only guard stays on; the only extra request it allows is the login form's own POST.
 * The outcome is recorded on the connection for Settings → Source connection. Never logs the credentials.
 */
export async function autoLogin(connectionId: string, log: (m: string) => void = console.log): Promise<AutoLoginResult> {
  const conn = await prisma.sourceConnection.findUniqueOrThrow({ where: { id: connectionId } });
  const adapter = getAdapter(conn.adapterKey);
  const record = async (result: AutoLoginResult) => {
    await prisma.sourceConnection.update({
      where: { id: connectionId },
      data: result.ok ? { autoLoginAt: new Date(), autoLoginError: null } : { autoLoginError: result.reason.slice(0, 300) },
    });
    return result;
  };

  if (!adapter.autoLogin) return record({ ok: false, reason: "Automatic sign-in is not available for this source." });
  let credentials: SourceCredentials | null;
  try {
    credentials = await loadCredentials(connectionId);
  } catch {
    return record({ ok: false, reason: "The saved password could not be decrypted (the encryption key changed). Save it again in Settings." });
  }
  if (!credentials) return record({ ok: false, reason: "No MahaHRD username and password are saved. Add them in Settings → Source connection." });

  log(`signing in to ${conn.name} automatically…`);
  const browser = await launchBrowser({ headless: true });
  try {
    const context = await browser.newContext();
    const policy = adapter.guardPolicy(conn.baseUrl);
    await installGuard(context, { ...policy, allowedPostPaths: [...policy.allowedPostPaths, ...(adapter.loginPostPaths ?? [])] });
    const page = await context.newPage();
    await adapter.autoLogin(page, conn.baseUrl, credentials);
    await saveSession(connectionId, context);
    log(`signed in to ${conn.name}; session saved`);
    return record({ ok: true });
  } catch (err) {
    const reason =
      err instanceof AdapterError && err.code === "LOGIN_REJECTED"
        ? `${conn.name} refused the sign-in: ${err.message}`
        : `Sign-in did not complete: ${err instanceof Error ? err.message.split("\n")[0].slice(0, 200) : "unknown error"}`;
    log(reason);
    return record({ ok: false, reason });
  } finally {
    await browser.close();
  }
}
