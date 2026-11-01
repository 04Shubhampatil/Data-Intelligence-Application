import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for secrets at rest (source-dashboard session cookies, passwords).
 * Format: "v1.<iv b64url>.<tag b64url>.<ciphertext b64url>".
 * The key (32 bytes, base64) lives only in CREDENTIALS_ENCRYPTION_KEY.
 */
export function loadKey(b64 = process.env.CREDENTIALS_ENCRYPTION_KEY): Buffer {
  if (!b64) throw new Error("CREDENTIALS_ENCRYPTION_KEY is not set");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("CREDENTIALS_ENCRYPTION_KEY must be 32 bytes (base64)");
  return key;
}

export function encryptSecret(plaintext: string, key = loadKey(), aad = "di-secret"): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, key = loadKey(), aad = "di-secret"): string {
  const [v, iv, tag, ct] = payload.split(".");
  if (v !== "v1" || !iv || !tag || ct === undefined) throw new Error("Unrecognised secret format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}
