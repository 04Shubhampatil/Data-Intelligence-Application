import { prisma } from "@di/db";

export const DEFAULT_SOURCE = { name: "MahaHRD", adapterKey: "mahahrd", baseUrl: "https://mahahrd.com" } as const;

export async function getSourceConnection() {
  const conn = await prisma.sourceConnection.findFirst({ where: { adapterKey: DEFAULT_SOURCE.adapterKey, isActive: true } });
  if (!conn) throw new Error("No MahaHRD source connection. Run: npm run setup:source -w @di/worker");
  return conn;
}
