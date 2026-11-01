import "server-only";
import { prisma, type Prisma } from "@di/db";
import type { CurrentUser } from "./session";
import { audit } from "@/server/security/audit";

/**
 * District isolation — the single place that turns a user into a Prisma constraint.
 * Global users (no assignments) see everything; scoped users see only candidates
 * whose district is in their assignment list. Records with no district are
 * visible to global users only (never guessed into a district).
 */
export function isScoped(user: Pick<CurrentUser, "districtScopeIds">) {
  return user.districtScopeIds.length > 0;
}

export function candidateScope(user: Pick<CurrentUser, "districtScopeIds">): Prisma.CandidateWhereInput {
  return isScoped(user) ? { districtId: { in: user.districtScopeIds } } : {};
}

/** For lookups (projects, designations…): only values that occur among candidates the user can see. */
export function lookupScope(user: Pick<CurrentUser, "districtScopeIds">): { candidates: { some: Prisma.CandidateWhereInput } } | Record<string, never> {
  return isScoped(user) ? { candidates: { some: { ...candidateScope(user), isDeletedAtSource: false } } } : {};
}

export function districtInScope(user: Pick<CurrentUser, "districtScopeIds">, districtId: string | null | undefined) {
  if (!isScoped(user)) return true;
  return !!districtId && user.districtScopeIds.includes(districtId);
}

/**
 * Called when a lookup by id returned nothing for a scoped user. If the record
 * exists outside their scope, log the attempt (id probing) — the caller still
 * answers 404 so the response is identical either way.
 */
export async function recordAccessDeniedIfExists(user: CurrentUser, candidateId: string, context: string) {
  if (!isScoped(user)) return;
  const exists = await prisma.candidate.findUnique({ where: { id: candidateId }, select: { districtId: true } });
  if (exists && !districtInScope(user, exists.districtId)) {
    await audit("ACCESS_DENIED", { userId: user.id, target: candidateId, metadata: { context } });
  }
}
