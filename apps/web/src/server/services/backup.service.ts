import "server-only";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/** Lists MySQL dump files written by the backup container (BACKUP_DIR, default ./backups at the repo root). */
export async function listBackups() {
  const dir = process.env.BACKUP_DIR || path.resolve(process.cwd(), "../../backups");
  try {
    // The backup folder is a runtime location (BACKUP_DIR), not app code: keep it out of build tracing.
    const names = (await readdir(/* turbopackIgnore: true */ dir)).filter((n) => n.endsWith(".sql.gz"));
    const files = await Promise.all(names.map(async (name) => ({ name, ...(await stat(path.join(/* turbopackIgnore: true */ dir, name))) })));
    const sorted = files.map((f) => ({ name: f.name, size: f.size, modifiedAt: f.mtime })).sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
    return { dir, files: sorted, latestAgeHours: sorted[0] ? (Date.now() - sorted[0].modifiedAt.getTime()) / 3_600_000 : null };
  } catch {
    return { dir, files: [] as { name: string; size: number; modifiedAt: Date }[], latestAgeHours: null as number | null };
  }
}
