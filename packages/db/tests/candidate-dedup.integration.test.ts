/**
 * Integration test against the real MySQL database in DATABASE_URL.
 * Uses synthetic data only and rolls everything back, leaving no rows behind.
 */
import { describe, expect, it } from "vitest";

const hasDb = !!process.env.DATABASE_URL;
const ROLLBACK = new Error("rollback");

describe.skipIf(!hasDb)("Candidate dedup (MySQL)", async () => {
  const { prisma } = await import("../src/index");

  async function inRolledBackTx(fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<void>) {
    await expect(
      prisma.$transaction(async (tx) => {
        await fn(tx);
        throw ROLLBACK;
      }),
    ).rejects.toBe(ROLLBACK);
  }

  it("rejects a second candidate with the same source + employee code", async () => {
    await inRolledBackTx(async (tx) => {
      const src = await tx.sourceConnection.create({
        data: { name: "TEST", adapterKey: "test", baseUrl: "https://example.test", username: "x", encryptedSecret: "x" },
      });
      const base = { sourceConnectionId: src.id, sourceEmployeeCode: "E0001", fullName: "Synthetic Person", contentHash: "h1", lastSyncedAt: new Date() };
      await tx.candidate.create({ data: base });
      await expect(tx.candidate.create({ data: { ...base, fullName: "Other" } })).rejects.toMatchObject({ code: "P2002" });
    });
  });

  it("upsert on the dedup key updates in place instead of duplicating", async () => {
    await inRolledBackTx(async (tx) => {
      const src = await tx.sourceConnection.create({
        data: { name: "TEST", adapterKey: "test", baseUrl: "https://example.test", username: "x", encryptedSecret: "x" },
      });
      const key = { sourceConnectionId_sourceEmployeeCode: { sourceConnectionId: src.id, sourceEmployeeCode: "E0002" } };
      const create = { sourceConnectionId: src.id, sourceEmployeeCode: "E0002", fullName: "First", contentHash: "h1", lastSyncedAt: new Date() };

      await tx.candidate.upsert({ where: key, create, update: { fullName: "First", contentHash: "h1" } });
      await tx.candidate.upsert({ where: key, create, update: { fullName: "Second", contentHash: "h2" } });

      const rows = await tx.candidate.findMany({ where: { sourceConnectionId: src.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ fullName: "Second", contentHash: "h2" });
    });
  });

  it("same employee code under a different source is a different record", async () => {
    await inRolledBackTx(async (tx) => {
      const mk = () =>
        tx.sourceConnection.create({ data: { name: "TEST", adapterKey: "test", baseUrl: "https://example.test", username: "x", encryptedSecret: "x" } });
      const [a, b] = [await mk(), await mk()];
      for (const s of [a, b]) {
        await tx.candidate.create({
          data: { sourceConnectionId: s.id, sourceEmployeeCode: "E0003", fullName: "Same Code", contentHash: "h", lastSyncedAt: new Date() },
        });
      }
      expect(await tx.candidate.count({ where: { sourceEmployeeCode: "E0003", sourceConnectionId: { in: [a.id, b.id] } } })).toBe(2);
    });
  });
});
