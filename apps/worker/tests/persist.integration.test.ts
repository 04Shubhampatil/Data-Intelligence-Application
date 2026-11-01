/**
 * Pipeline integration test against MySQL with SYNTHETIC data only.
 * Proves: create → identical re-run is UNCHANGED → changed content is UPDATED,
 * gated fields are not stored, and everything is cleaned up afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultAllowedFields, type FieldKey } from "@di/core";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("persistRecord (MySQL)", async () => {
  const { prisma } = await import("@di/db");
  const { persistRecord, prepareRecord } = await import("../src/pipeline/persist");
  const TAG = `ZZTEST-${Date.now()}`;
  let sourceId = "";
  let jobId = "";

  beforeAll(async () => {
    const src = await prisma.sourceConnection.create({ data: { name: TAG, adapterKey: "synthetic", baseUrl: "https://example.test" } });
    sourceId = src.id;
    jobId = (await prisma.syncJob.create({ data: { sourceConnectionId: sourceId, status: "RUNNING" } })).id;
  });

  afterAll(async () => {
    await prisma.syncJob.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.candidate.deleteMany({ where: { sourceConnectionId: sourceId } });
    await prisma.sourceConnection.delete({ where: { id: sourceId } });
    await prisma.subProject.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.departmentHead.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.department.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.designation.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.district.deleteMany({ where: { name: { startsWith: TAG } } });
  });

  const raw = () => ({
    sourceEmployeeCode: "E900001",
    fullName: "SYNTHETIC PERSON",
    district: `${TAG} DISTRICT`,
    departmentHead: `${TAG} PROJECT`,
    department: `${TAG} DEPT`,
    subProject: `${TAG} SUB`,
    designation: `${TAG} ENGINEER`,
    gender: "Female",
    joiningDate: "15 Jan 2024",
    mobile: "9000000001",
  });

  it("creates, then reports UNCHANGED for identical content, then UPDATED", async () => {
    const allowed = defaultAllowedFields();
    const first = await persistRecord(sourceId, prepareRecord(raw(), allowed), allowed, jobId);
    expect(first.outcome).toBe("CREATED");

    const again = await persistRecord(sourceId, prepareRecord(raw(), allowed), allowed, jobId);
    expect(again).toEqual({ outcome: "UNCHANGED", candidateId: first.candidateId });

    const changed = await persistRecord(sourceId, prepareRecord({ ...raw(), designation: `${TAG} SENIOR ENGINEER` }, allowed), allowed, jobId);
    expect(changed).toEqual({ outcome: "UPDATED", candidateId: first.candidateId });

    expect(await prisma.candidate.count({ where: { sourceConnectionId: sourceId } })).toBe(1);
    const c = await prisma.candidate.findUniqueOrThrow({
      where: { id: first.candidateId },
      include: { district: true, departmentHead: true, department: true, subProject: true, designation: true, profile: true },
    });
    expect(c.fullName).toBe("Synthetic Person");
    expect(c.district?.name).toBe(`${TAG} DISTRICT`);
    expect(c.subProject?.name).toBe(`${TAG} SUB`);
    expect(c.designation?.name).toBe(`${TAG} SENIOR ENGINEER`);
    expect(c.joiningDate?.toISOString().slice(0, 10)).toBe("2024-01-15");
    expect(c.profile).toBeNull(); // mobile is approval-gated → not stored
    expect(await prisma.syncRecord.count({ where: { syncJobId: jobId } })).toBe(3);
  });

  it("stores the gated mobile only when it is approved", async () => {
    const allowed = new Set<FieldKey>([...defaultAllowedFields(), "mobile"]);
    const r = await persistRecord(sourceId, prepareRecord({ ...raw(), sourceEmployeeCode: "E900002" }, allowed), allowed, jobId);
    const p = await prisma.candidateProfile.findUnique({ where: { candidateId: r.candidateId } });
    expect(p?.mobile).toBe("+919000000001");
  });

  it("rejects invalid records with field names only (no values) in the error", () => {
    expect(() => prepareRecord({ sourceEmployeeCode: "bad code!", fullName: "SECRET NAME" }, defaultAllowedFields())).toThrow(
      /^Validation failed for: sourceEmployeeCode$/,
    );
  });
});
