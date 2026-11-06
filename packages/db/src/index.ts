import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "./generated/client";

export * from "./generated/client";
export * from "./permissions";

/**
 * Builds the MySQL/MariaDB driver config from DATABASE_URL.
 * MySQL 8 uses caching_sha2_password, which needs public-key retrieval
 * when the connection is not TLS (local dev). In production, use TLS.
 */
function adapterFromUrl(raw: string) {
  const url = new URL(raw);
  return new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    connectionLimit: Number(url.searchParams.get("connection_limit") ?? 10),
    allowPublicKeyRetrieval: url.searchParams.get("ssl") !== "true",
  });
}

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: adapterFromUrl(url) });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaClass?: typeof PrismaClient };

/**
 * Singleton — avoids exhausting connections during Next.js hot reload. After `prisma generate` (a schema
 * change) the dev server recompiles this module with a NEW PrismaClient class; the cached instance would
 * still validate against the old schema (e.g. reject a new enum value), so it is replaced. In production
 * the class never changes and the one instance is kept.
 */
function getClient(): PrismaClient {
  if (globalForPrisma.prisma && globalForPrisma.prismaClass !== PrismaClient) {
    void globalForPrisma.prisma.$disconnect().catch(() => {});
    globalForPrisma.prisma = undefined;
  }
  globalForPrisma.prismaClass = PrismaClient;
  return (globalForPrisma.prisma ??= createClient());
}

/**
 * Lazily-initialised client: importing this module (e.g. during `next build`)
 * never needs DATABASE_URL; the first actual query does.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
