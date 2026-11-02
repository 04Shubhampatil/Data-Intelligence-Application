/**
 * Encrypted storage of "Profile & employment" details (MySQL, SYNTHETIC data, cleaned up).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, personalAad, type FieldKey, type PersonalDetails } from "@di/core";

const hasDb = !!process.env.DATABASE_URL && !!process.env.CREDENTIALS_ENCRYPTION_KEY;

describe.skipIf(!hasDb)("savePersonalDetails (MySQL)", async () => {
  const { prisma } = await import("@di/db");
  const { savePersonalDetails, persistRecord, prepareRecord } = await import("../src/pipeline/persist");
  const TAG = `ZZPERS-${Date.now()}`;
  let sourceId = "", jobId = "", candidateId = "";
  const allowed = new Set<FieldKey>(["personalDetails", "taluka"]);
  const details: PersonalDetails = {
    fatherOrHusbandName: "Synthetic Father",
    dateOfBirth: "01 January 1990",
    pincode: "400001",
    education: [{ qualification: "SSC", board: "Test Board", yearOfPassing: "2005", marks: "410" }],
    employment: [],
    nominees: [{ name: "Synthetic Nominee", relationship: "Mother" }],
  };

  beforeAll(async () => {
    sourceId = (await prisma.sourceConnection.create({ data: { name: TAG, adapterKey: "synthetic", baseUrl: "https://example.test" } })).id;
    jobId = (await prisma.syncJob.create({ data: { sourceConnectionId: sourceId, status: "RUNNING" } })).id;
    const rec = prepareRecord({ sourceEmployeeCode: "E900777", fullName: "SYNTHETIC PERSONAL" }, allowed);
    candidateId = (await persistRecord(sourceId, rec, allowed, jobId)).candidateId;
  });

  afterAll(async () => {
    await prisma.syncJob.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.candidate.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.sourceConnection.delete({ where: { id: sourceId } });
  });

  it("stores the details encrypted and bound to the candidate", async () => {
    expect(await savePersonalDetails(candidateId, details, allowed)).toBe("STORED");
    const row = await prisma.candidateProfile.findUniqueOrThrow({ where: { candidateId } });
    expect(row.personalEncrypted).toMatch(/^v1\./);
    expect(row.personalEncrypted).not.toContain("Synthetic Father");
    expect(JSON.parse(decryptSecret(row.personalEncrypted!, undefined, personalAad(candidateId)))).toMatchObject({ fatherOrHusbandName: "Synthetic Father" });
    // Ciphertext copied to another candidate does not decrypt there.
    expect(() => decryptSecret(row.personalEncrypted!, undefined, personalAad("someoneelse"))).toThrow();
  });

  it("is UNCHANGED for identical details and re-encrypts on change", async () => {
    const before = (await prisma.candidateProfile.findUniqueOrThrow({ where: { candidateId } })).personalEncrypted;
    expect(await savePersonalDetails(candidateId, { ...details }, allowed)).toBe("UNCHANGED");
    expect((await prisma.candidateProfile.findUniqueOrThrow({ where: { candidateId } })).personalEncrypted).toBe(before);
    expect(await savePersonalDetails(candidateId, { ...details, bloodGroup: "O+" }, allowed)).toBe("STORED");
  });

  it("a listing-only update (no contact fields) keeps the stored details", async () => {
    const rec = prepareRecord({ sourceEmployeeCode: "E900777", fullName: "SYNTHETIC PERSONAL RENAMED" }, allowed);
    expect((await persistRecord(sourceId, rec, allowed, jobId)).outcome).toBe("UPDATED");
    expect((await prisma.candidateProfile.findUniqueOrThrow({ where: { candidateId } })).personalEncrypted).not.toBeNull();
  });

  it("removes the stored copy when the field is no longer approved", async () => {
    expect(await savePersonalDetails(candidateId, details, new Set<FieldKey>(["taluka"]))).toBe("CLEARED");
    const row = await prisma.candidateProfile.findUniqueOrThrow({ where: { candidateId } });
    expect(row.personalEncrypted).toBeNull();
    expect(row.personalHash).toBeNull();
  });
});
