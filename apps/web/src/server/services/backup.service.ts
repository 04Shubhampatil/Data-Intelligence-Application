import "server-only";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/** Lists MySQL dump files written by the backup container (BACKUP_DIR, default ./backups at the repo root). */
export async function listBackups() {
  const dir = process.env.BACKUP_DIR || path.resolve(process.cwd(), "../../backups");
  try {
    const names = (await readdir(dir)).filter((n) => n.endsWith(".sql.gz"));
    const files = await Promise.all(names.map(async (name) => ({ name, ...(await stat(path.join(dir, name))) })));
    return {
      dir,
      files: files.map((f) => ({ name: f.name, size: f.size, modifiedAt: f.mtime })).sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime()),
    };
  } catch {
    return { dir, files: [] as { name: string; size: number; modifiedAt: Date }[] };
  }
}
