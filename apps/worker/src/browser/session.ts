import type { BrowserContext } from "playwright";
import { decryptSecret, encryptSecret } from "@di/core";
import { prisma } from "@di/db";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
const AAD = (connectionId: string) => `source-session:${connectionId}`;

/** Saves the context's cookies/localStorage, encrypted, on the SourceConnection. */
export async function saveSession(connectionId: string, context: BrowserContext) {
  const state = await context.storageState();
  await prisma.sourceConnection.update({
    where: { id: connectionId },
    data: { encryptedSession: encryptSecret(JSON.stringify(state), undefined, AAD(connectionId)), sessionSavedAt: new Date() },
  });
  return { cookies: state.cookies.length };
}

export async function loadSession(connectionId: string): Promise<StorageState | null> {
  const c = await prisma.sourceConnection.findUniqueOrThrow({ where: { id: connectionId }, select: { encryptedSession: true } });
  if (!c.encryptedSession) return null;
  return JSON.parse(decryptSecret(c.encryptedSession, undefined, AAD(connectionId))) as StorageState;
}

export async function clearSession(connectionId: string) {
  await prisma.sourceConnection.update({ where: { id: connectionId }, data: { encryptedSession: null, sessionSavedAt: null } });
}
