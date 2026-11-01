import { applyAllowList, candidateRecordSchema, contentHash, type CandidateRecord, type FieldKey } from "@di/core";
import { prisma, type Prisma } from "@di/db";

type Tx = Prisma.TransactionClient;
export type Outcome = "CREATED" | "UPDATED" | "UNCHANGED";

export class ValidationFailure extends Error {
  constructor(public fields: string[]) {
    // Field NAMES only — never values, so no PII reaches logs or SyncError rows.
    super(`Validation failed for: ${fields.join(", ")}`);
  }
}

/** allow-list → validate → normalise. Throws ValidationFailure (no values in the message). */
export function prepareRecord(raw: Record<string, unknown>, allowed: ReadonlySet<FieldKey>): CandidateRecord {
  const filtered = applyAllowList(raw, allowed);
  const parsed = candidateRecordSchema.safeParse(filtered);
  if (!parsed.success) {
    throw new ValidationFailure([...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "record")))]);
  }
  return parsed.data;
}

async function lookupId(tx: Tx, model: "district" | "departmentHead" | "department" | "designation", name?: string | null) {
  if (!name) return null;
  // Each lookup model has `name @unique`.
  const delegate = tx[model] as unknown as {
    upsert(args: { where: { name: string }; update: object; create: { name: string } }): Promise<{ id: string }>;
  };
  return (await delegate.upsert({ where: { name }, update: {}, create: { name } })).id;
}

/**
 * Upserts one validated record on the dedup key (source connection + employee code).
 * Identical content ⇒ UNCHANGED (only lastSyncedAt moves).
 */
export async function persistRecord(
  sourceConnectionId: string,
  rec: CandidateRecord,
  allowed: ReadonlySet<FieldKey>,
  syncJobId: string,
  opts: { profileSynced?: boolean } = {},
): Promise<{ outcome: Outcome; candidateId: string }> {
  const hash = contentHash(rec);
  const now = new Date();
  const profileStamp = opts.profileSynced ? { profileSyncedAt: now } : {};

  return prisma.$transaction(async (tx) => {
    const key = { sourceConnectionId_sourceEmployeeCode: { sourceConnectionId, sourceEmployeeCode: rec.sourceEmployeeCode } };
    const existing = await tx.candidate.findUnique({ where: key, select: { id: true, contentHash: true } });

    let outcome: Outcome;
    let candidateId: string;

    if (existing && existing.contentHash === hash) {
      await tx.candidate.update({ where: { id: existing.id }, data: { lastSyncedAt: now, isDeletedAtSource: false, ...profileStamp } });
      outcome = "UNCHANGED";
      candidateId = existing.id;
    } else {
      const departmentHeadId = await lookupId(tx, "departmentHead", rec.departmentHead);
      const subProjectId =
        rec.subProject && departmentHeadId
          ? (
              await tx.subProject.upsert({
                where: { departmentHeadId_name: { departmentHeadId, name: rec.subProject } },
                update: {},
                create: { departmentHeadId, name: rec.subProject },
              })
            ).id
          : null;

      const data = {
        fullName: rec.fullName,
        gender: rec.gender ?? null,
        employeeType: rec.employeeType ?? null,
        taluka: rec.taluka ?? null,
        joiningDate: rec.joiningDate ?? null,
        sourceStatus: rec.sourceStatus ?? null,
        docVerificationStatus: rec.docVerificationStatus ?? null,
        districtId: await lookupId(tx, "district", rec.district),
        departmentHeadId,
        departmentId: await lookupId(tx, "department", rec.department),
        subProjectId,
        designationId: await lookupId(tx, "designation", rec.designation),
        contentHash: hash,
        lastSyncedAt: now,
        isDeletedAtSource: false,
        ...profileStamp,
      };

      const saved = existing
        ? await tx.candidate.update({ where: { id: existing.id }, data })
        : await tx.candidate.create({ data: { ...data, sourceConnectionId, sourceEmployeeCode: rec.sourceEmployeeCode } });
      outcome = existing ? "UPDATED" : "CREATED";
      candidateId = saved.id;

      // Approval-gated contact fields: stored only when allow-listed, otherwise removed.
      const mobile = allowed.has("mobile") ? (rec.mobile ?? null) : null;
      const officialEmail = allowed.has("officialEmail") ? (rec.officialEmail ?? null) : null;
      if (mobile || officialEmail) {
        await tx.candidateProfile.upsert({
          where: { candidateId },
          update: { mobile, officialEmail },
          create: { candidateId, mobile, officialEmail },
        });
      } else {
        await tx.candidateProfile.deleteMany({ where: { candidateId } });
      }
    }

    await tx.syncRecord.create({ data: { syncJobId, candidateId, sourceEmployeeCode: rec.sourceEmployeeCode, outcome } });
    return { outcome, candidateId };
  });
}

/** Profile-page fields as currently stored, used when a run doesn't re-read the profile. */
export async function getExistingCandidate(sourceConnectionId: string, sourceEmployeeCode: string) {
  return prisma.candidate.findUnique({
    where: { sourceConnectionId_sourceEmployeeCode: { sourceConnectionId, sourceEmployeeCode } },
    select: { id: true, profileSyncedAt: true, taluka: true, joiningDate: true, sourceStatus: true, docVerificationStatus: true },
  });
}

type Existing = NonNullable<Awaited<ReturnType<typeof getExistingCandidate>>>;

/**
 * When the profile page was not read this run, keep the stored profile values
 * so the record hashes identically (UNCHANGED) instead of being blanked.
 */
export function carryOverProfileFields(rec: CandidateRecord, existing: Existing | null, allowed: ReadonlySet<FieldKey>): CandidateRecord {
  if (!existing) return rec;
  const out = { ...rec };
  if (allowed.has("taluka") && existing.taluka) out.taluka = existing.taluka;
  if (allowed.has("joiningDate") && existing.joiningDate) out.joiningDate = existing.joiningDate;
  if (allowed.has("sourceStatus") && existing.sourceStatus) out.sourceStatus = existing.sourceStatus;
  if (allowed.has("docVerificationStatus") && existing.docVerificationStatus) {
    out.docVerificationStatus = existing.docVerificationStatus as CandidateRecord["docVerificationStatus"];
  }
  return out;
}
