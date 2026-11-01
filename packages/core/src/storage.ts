import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Private file storage. Local directory now (FILES_DIR, a Docker volume in
 * production); the same interface can be backed by S3-compatible storage later.
 * Keys are content-addressed: candidates/<candidateId>/<kind>/<sha256>.<ext>.
 * Nothing here is ever exposed as a URL.
 */
export interface FileStorage {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

const SAFE_KEY = /^[A-Za-z0-9_\-/.]+$/;

export function assertSafeKey(key: string) {
  if (!SAFE_KEY.test(key) || key.includes("..") || key.startsWith("/")) throw new Error("Unsafe storage key");
}

export function storageRoot() {
  return process.env.FILES_DIR || path.resolve(process.cwd(), "data", "files");
}

export class LocalFileStorage implements FileStorage {
  constructor(private root = storageRoot()) {}
  private full(key: string) {
    assertSafeKey(key);
    return path.join(this.root, key);
  }
  async put(key: string, bytes: Uint8Array) {
    const f = this.full(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, bytes, { mode: 0o600 });
  }
  async get(key: string) {
    return new Uint8Array(await readFile(this.full(key)));
  }
  async exists(key: string) {
    return stat(this.full(key)).then(() => true, () => false);
  }
  async delete(key: string) {
    await rm(this.full(key), { force: true });
  }
}

export const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function documentKey(candidateId: string, kind: string, sha256: string, ext: string) {
  const key = `candidates/${candidateId}/${kind}/${sha256}.${ext}`;
  assertSafeKey(key);
  return key;
}
