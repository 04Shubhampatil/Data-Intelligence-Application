import "../env";
import { readFileSync, writeFileSync } from "node:fs";
import { decryptSecret, encryptSecret } from "@di/core";
import { prisma } from "@di/db";
import { getSourceConnection } from "./source";

/**
 * Moves the (encrypted) source session between machines — e.g. sign in on a PC
 * with a screen, run the worker on a headless VPS.
 *
 *   npm run source:session:export -- session.enc     # on the PC, after `npm run source:login`
 *   npm run source:session:import -- session.enc     # on the VPS (same CREDENTIALS_ENCRYPTION_KEY)
 *
 * The file is AES-256-GCM ciphertext bound to the adapter key, never plaintext cookies.
 * Delete it after importing.
 */
const [mode, file] = process.argv.slice(2);
if ((mode !== "export" && mode !== "import") || !file) {
  console.error("Usage: session-transfer <export|import> <file>");
  process.exit(2);
}

const conn = await getSourceConnection();
const transferAad = `source-session-transfer:${conn.adapterKey}`;
const storageAad = `source-session:${conn.id}`;

if (mode === "export") {
  if (!conn.encryptedSession) {
    console.error("No saved session. Run `npm run source:login` first.");
    process.exit(1);
  }
  const plain = decryptSecret(conn.encryptedSession, undefined, storageAad);
  writeFileSync(file, encryptSecret(plain, undefined, transferAad), { mode: 0o600 });
  console.log(`Wrote ${file}. Copy it to the server, import it there, then delete both copies.`);
} else {
  const payload = readFileSync(file, "utf8").trim();
  const plain = decryptSecret(payload, undefined, transferAad); // throws if the key differs or the file was altered
  await prisma.sourceConnection.update({
    where: { id: conn.id },
    data: { encryptedSession: encryptSecret(plain, undefined, storageAad), sessionSavedAt: new Date() },
  });
  console.log(`Session imported for "${conn.name}". You can delete ${file} now.`);
}
await prisma.$disconnect();
