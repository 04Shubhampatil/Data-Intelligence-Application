import "server-only";
import { decryptSecret, MASKED_FIELDS, maskId, SENSITIVE_GROUP_KEYS, SENSITIVE_GROUPS, sensitiveAad, type SensitiveGroup } from "@di/core";
import { prisma, type Permission } from "@di/db";
import type { CurrentUser } from "@/server/auth/session";
import { candidateScope } from "@/server/auth/scope";
import { hasPermission } from "@/lib/rbac";
import { audit } from "@/server/security/audit";

export type GroupView =
  | { group: SensitiveGroup; label: string; state: "forbidden" | "none" | "unreadable" }
  | { group: SensitiveGroup; label: string; state: "ok"; data: Record<string, unknown>; masked: boolean; canReveal: boolean; syncedAt: Date };

/** Masks identifier fields (recursively, e.g. identity.others[].number) for ordinary views. */
export function maskGroup(group: SensitiveGroup, data: unknown): unknown {
  const fields = new Set(MASKED_FIELDS[group] ?? []);
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fields.has(k) && typeof x === "string" ? maskId(x) : walk(x)]));
    return v;
  };
  return walk(data);
}

/**
 * Decrypts the sensitive groups of one candidate for display.
 * - each group needs its own permission (Super Admin only by default) and the candidate in scope;
 * - identifiers are masked unless the user asked to reveal that group (audited separately);
 * - every decrypted view is audit-logged (group names only, never values);
 * - never used by the AI tools or exports.
 */
export async function getSensitiveGroups(candidateId: string, user: CurrentUser, reveal: ReadonlySet<string> = new Set()): Promise<GroupView[]> {
  const permitted = SENSITIVE_GROUP_KEYS.filter((g) => hasPermission(user.permissions, SENSITIVE_GROUPS[g].permission as Permission));
  const out: GroupView[] = SENSITIVE_GROUP_KEYS.filter((g) => !permitted.includes(g)).map((g) => ({ group: g, label: SENSITIVE_GROUPS[g].label, state: "forbidden" as const }));
  if (!permitted.length) return out;

  const inScope = await prisma.candidate.findFirst({ where: { id: candidateId, ...candidateScope(user), isDeletedAtSource: false }, select: { id: true } });
  if (!inScope) return SENSITIVE_GROUP_KEYS.map((g) => ({ group: g, label: SENSITIVE_GROUPS[g].label, state: "forbidden" as const }));

  const rows = await prisma.candidateSensitiveData.findMany({ where: { candidateId, group: { in: permitted } } });
  const viewed: string[] = [];
  const revealed: string[] = [];
  for (const g of permitted) {
    const row = rows.find((r) => r.group === g);
    const label = SENSITIVE_GROUPS[g].label;
    if (!row) {
      out.push({ group: g, label, state: "none" });
      continue;
    }
    try {
      const parsed = SENSITIVE_GROUPS[g].schema.safeParse(JSON.parse(decryptSecret(row.encrypted, undefined, sensitiveAad(candidateId, g))));
      if (!parsed.success) throw new Error("schema");
      const hasMaskable = (MASKED_FIELDS[g] ?? []).length > 0;
      const unmask = hasMaskable && reveal.has(g);
      out.push({ group: g, label, state: "ok", data: (unmask ? parsed.data : maskGroup(g, parsed.data)) as Record<string, unknown>, masked: hasMaskable && !unmask, canReveal: hasMaskable, syncedAt: row.syncedAt });
      viewed.push(g);
      if (unmask) revealed.push(g);
    } catch {
      out.push({ group: g, label, state: "unreadable" }); // wrong key, tampered or swapped ciphertext
    }
  }
  if (viewed.length) await audit("SENSITIVE_VIEW", { userId: user.id, target: candidateId, metadata: { groups: viewed } });
  if (revealed.length) await audit("SENSITIVE_REVEAL", { userId: user.id, target: candidateId, metadata: { groups: revealed } });
  return out.sort((a, b) => SENSITIVE_GROUP_KEYS.indexOf(a.group) - SENSITIVE_GROUP_KEYS.indexOf(b.group));
}

/** Latest attendance months (default 3) — needs attendance:read and the candidate in scope. */
export async function getAttendance(candidateId: string, user: CurrentUser, take = 3) {
  if (!hasPermission(user.permissions, "attendance:read")) return null;
  return prisma.candidateAttendanceMonth.findMany({
    where: { candidateId, candidate: { ...candidateScope(user), isDeletedAtSource: false } },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    take,
  });
}

/** Ticket list — needs tickets:read and the candidate in scope. */
export async function getTickets(candidateId: string, user: CurrentUser) {
  if (!hasPermission(user.permissions, "tickets:read")) return null;
  return prisma.candidateTicket.findMany({
    where: { candidateId, candidate: { ...candidateScope(user), isDeletedAtSource: false } },
    orderBy: [{ syncedAt: "desc" }, { sourceTicketId: "desc" }],
    take: 100,
  });
}
