/** Where the one shared client lives (globalThis in the app, so every bundle sees the same one). */
export type ClientCache<C> = { prisma?: C; prismaClass?: unknown };

/**
 * Returns the shared database client, creating it once.
 *
 * Production: always the same client. The production build copies this module into several chunks, so
 * each chunk has its own PrismaClient class; swapping the client whenever the class "changed" closed
 * the pool under requests still using it ("pool is closed" — the District page crash, 2026-11-07).
 *
 * Development: after `prisma generate` the dev server recompiles with a NEW class, and the cached client
 * would still check queries against the old schema, so it is replaced. The old one is closed a little
 * later, so queries already running on it can finish.
 */
export function sharedClient<C extends { $disconnect(): Promise<void> }>(
  cache: ClientCache<C>,
  currentClass: unknown,
  create: () => C,
  isProduction: boolean,
  closeDelayMs = 30_000,
): C {
  if (!isProduction && cache.prisma && cache.prismaClass !== currentClass) {
    const old = cache.prisma;
    setTimeout(() => void old.$disconnect().catch(() => {}), closeDelayMs).unref?.();
    cache.prisma = undefined;
  }
  if (!cache.prisma) {
    cache.prisma = create();
    cache.prismaClass = currentClass;
  }
  return cache.prisma;
}
