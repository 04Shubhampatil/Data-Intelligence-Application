import {
  encryptSecret,
  groupHash,
  SENSITIVE_GROUP_KEYS,
  SENSITIVE_GROUPS,
  sensitiveAad,
  type FieldKey,
  type SensitiveData,
} from "@di/core";
import { prisma } from "@di/db";
import type { AttendanceMonth, TicketRow } from "../adapters/types";

export type GroupOutcome = "STORED" | "UNCHANGED" | "CLEARED" | "NONE";

/**
 * Stores each approved sensitive group as its own AES-256-GCM blob (bound to candidate + group).
 * Not approved, or no longer shown at the source → the stored copy is removed.
 * Only called when the profile page was actually read this run.
 */
export async function saveSensitiveGroups(candidateId: string, data: SensitiveData | undefined, allowed: ReadonlySet<FieldKey>, now = new Date()) {
  const result: Partial<Record<keyof SensitiveData, GroupOutcome>> = {};
  for (const group of SENSITIVE_GROUP_KEYS) {
    const value = data?.[group];
    const approved = allowed.has(SENSITIVE_GROUPS[group].fieldKey as FieldKey);
    if (!approved || value === undefined) {
      const r = await prisma.candidateSensitiveData.deleteMany({ where: { candidateId, group } });
      result[group] = r.count ? "CLEARED" : "NONE";
      continue;
    }
    const hash = groupHash(value);
    const existing = await prisma.candidateSensitiveData.findUnique({ where: { candidateId_group: { candidateId, group } }, select: { hash: true } });
    if (existing?.hash === hash) {
      await prisma.candidateSensitiveData.update({ where: { candidateId_group: { candidateId, group } }, data: { syncedAt: now } });
      result[group] = "UNCHANGED";
      continue;
    }
    const encrypted = encryptSecret(JSON.stringify(value), undefined, sensitiveAad(candidateId, group));
    await prisma.candidateSensitiveData.upsert({
      where: { candidateId_group: { candidateId, group } },
      update: { encrypted, hash, syncedAt: now },
      create: { candidateId, group, encrypted, hash, syncedAt: now },
    });
    result[group] = "STORED";
  }
  return result;
}

export async function saveOfficeLocation(candidateId: string, loc: { lat: number; lng: number } | undefined, allowed: ReadonlySet<FieldKey>) {
  const value = allowed.has("officeLocation") && loc ? { officeLat: loc.lat, officeLng: loc.lng } : { officeLat: null, officeLng: null };
  if (value.officeLat === null) {
    await prisma.candidateProfile.updateMany({ where: { candidateId }, data: value });
    return;
  }
  await prisma.candidateProfile.upsert({ where: { candidateId }, update: value, create: { candidateId, ...value } });
}

/** Upserts one month (idempotent on candidate + year + month). */
export async function saveAttendance(candidateId: string, m: AttendanceMonth, now = new Date()) {
  const { year, month, days, ...counts } = m;
  await prisma.candidateAttendanceMonth.upsert({
    where: { candidateId_year_month: { candidateId, year, month } },
    update: { ...counts, days, syncedAt: now },
    create: { candidateId, year, month, ...counts, days, syncedAt: now },
  });
  await prisma.candidate.update({ where: { id: candidateId }, data: { attendanceSyncedAt: now } });
}

/** Upserts tickets on (candidate, source ticket id). Tickets that disappear at the source are kept as history. */
export async function saveTickets(candidateId: string, rows: TicketRow[], now = new Date()) {
  for (const t of rows) {
    const { sourceTicketId, ...fields } = t;
    const data = {
      ticketNumber: fields.ticketNumber ?? null,
      type: fields.type ?? null,
      subject: fields.subject ?? null,
      priority: fields.priority ?? null,
      status: fields.status ?? null,
      feedback: fields.feedback ?? null,
      attachmentRef: fields.attachmentRef ?? null,
      syncedAt: now,
    };
    await prisma.candidateTicket.upsert({
      where: { candidateId_sourceTicketId: { candidateId, sourceTicketId } },
      update: data,
      create: { candidateId, sourceTicketId, ...data },
    });
  }
  await prisma.candidate.update({ where: { id: candidateId }, data: { ticketsSyncedAt: now } });
  return rows.length;
}
