// Sets a new password for one user, straight in the database. Used by reset-superadmin-password.ps1;
// it runs on the live server (or locally with -Local).
//
//   node reset-password.cjs <envFile> <modulesDir> [username]      (the new password is read from stdin)
//
// The password never goes on the command line (other users of the server could see it in the process
// list) and is never printed. Same rules and hashing as the Change password page (bcrypt, cost 12).
// It also clears a lockout from failed sign-ins, re-enables the account, and writes a PASSWORD_RESET
// audit entry.
"use strict";
const fs = require("fs");
const crypto = require("crypto");
const { createRequire } = require("module");

const [envFile, modulesDir, usernameArg = "superadmin"] = process.argv.slice(2);
if (!envFile || !modulesDir) {
  console.error("Usage: node reset-password.cjs <envFile> <modulesDir> [username]  (password on stdin)");
  process.exit(2);
}
const load = createRequire(require("path").resolve(modulesDir, "package.json"));
const bcrypt = load("bcryptjs");
const mariadb = load("mariadb");

/** Same as passwordPolicy in apps/web/src/lib/validation/auth.ts. */
function policyProblem(pw) {
  if (pw.length < 12) return "Use at least 12 characters";
  if (pw.length > 200) return "Use at most 200 characters";
  if (!/[a-z]/.test(pw)) return "Include a lowercase letter";
  if (!/[A-Z]/.test(pw)) return "Include an uppercase letter";
  if (!/\d/.test(pw)) return "Include a number";
  return null;
}

function databaseUrl() {
  const text = fs.readFileSync(envFile, "utf8");
  const m = text.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) throw new Error(`DATABASE_URL not found in ${envFile}`);
  return new URL(m[1]);
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  // Windows PowerShell may put a byte-order mark in front and CRLF at the end.
  return Buffer.concat(chunks).toString("utf8").replace(/^﻿/, "").replace(/\r?\n$/, "");
}

(async () => {
  const username = usernameArg.trim().toLowerCase();
  const password = await readStdin();
  const problem = policyProblem(password);
  if (problem) {
    console.error(`Password not accepted: ${problem}.`);
    process.exit(3);
  }

  const url = databaseUrl();
  const conn = await mariadb.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    allowPublicKeyRetrieval: url.searchParams.get("ssl") !== "true",
  });
  try {
    const rows = await conn.query("SELECT id, isActive FROM `User` WHERE username = ?", [username]);
    if (rows.length === 0) {
      console.error(`No user named "${username}". Nothing was changed.`);
      process.exit(4);
    }
    const { id, isActive } = rows[0];
    const hash = await bcrypt.hash(password, 12);
    await conn.query(
      "UPDATE `User` SET passwordHash = ?, failedLogins = 0, lockedUntil = NULL, isActive = 1, updatedAt = NOW(3) WHERE id = ?",
      [hash, id],
    );
    await conn.query(
      "INSERT INTO `AuditLog` (id, userId, action, target, metadata, createdAt) VALUES (?, ?, 'PASSWORD_RESET', ?, ?, NOW(3))",
      [crypto.randomUUID(), id, username, JSON.stringify({ via: "reset-password command" })],
    );
    console.log(`Password for "${username}" changed.${Number(isActive) ? "" : " The account was disabled and is now enabled."} Any sign-in lockout was cleared.`);
  } finally {
    await conn.end();
  }
})().catch((err) => {
  console.error("Reset failed:", err && err.message ? err.message : err);
  process.exit(1);
});
