import "server-only";
import { decryptSecret, personalAad, personalDetailsSchema, type PersonalDetails } from "@di/core";
import { prisma } from "@di/db";
import type { CurrentUser } from "@/server/auth/session";
import { candidateScope } from "@/server/auth/scope";
import { hasPermission } from "@/lib/rbac";
import { audit } from "@/server/security/audit";

export type PersonalView =
  | { state: "forbidden" }
  | { state: "none" }
  | { state: "unreadable" }
  | { state: "ok"; details: PersonalDetails; syncedAt: Date | null };

/**
 * Decrypts a candidate's "Profile & employment" details for display.
 * Requires `candidates:read_personal` and the candidate inside the user's districts.
 * Every successful read is audit-logged (no values in the log). Never used by the AI tools or exports.
 */
export async function getPersonalDetails(candidateId: string, user: CurrentUser): Promise<PersonalView> {
  if (!hasPermission(user.permissions, "candidates:read_personal")) return { state: "forbidden" };
  const row = await prisma.candidateProfile.findFirst({
    where: { candidateId, candidate: { ...candidateScope(user), isDeletedAtSource: false } },
    select: { personalEncrypted: true, personalSyncedAt: true },
  });
  if (!row?.personalEncrypted) return { state: "none" };
  try {
    const parsed = personalDetailsSchema.safeParse(JSON.parse(decryptSecret(row.personalEncrypted, undefined, personalAad(candidateId))));
    if (!parsed.success) return { state: "unreadable" };
    await audit("PERSONAL_VIEW", { userId: user.id, target: candidateId });
    return { state: "ok", details: parsed.data, syncedAt: row.personalSyncedAt };
  } catch {
    // Wrong key, tampered or swapped ciphertext: show nothing rather than guess.
    return { state: "unreadable" };
  }
}
