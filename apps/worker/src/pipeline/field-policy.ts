import { DOCUMENT_DEFS, DOCUMENT_KINDS, FIELD_DEFS, FIELD_KEYS, type DocumentKind, type FieldKey } from "@di/core";
import { prisma } from "@di/db";

/** Ensures a FieldPolicy row exists for every known field (defaults from FIELD_DEFS). Never overwrites decisions. */
export async function ensureFieldPolicies(sourceConnectionId: string) {
  for (const fieldKey of FIELD_KEYS) {
    await prisma.fieldPolicy.upsert({
      where: { sourceConnectionId_fieldKey: { sourceConnectionId, fieldKey } },
      update: {},
      create: { sourceConnectionId, fieldKey, allowed: FIELD_DEFS[fieldKey].defaultAllowed, maskInUi: fieldKey === "mobile" },
    });
  }
}

/** Ensures a DocumentPolicy row per kind (defaults from DOCUMENT_DEFS: identity/bank kinds off). Never overwrites decisions. */
export async function ensureDocumentPolicies(sourceConnectionId: string) {
  for (const kind of DOCUMENT_KINDS) {
    await prisma.documentPolicy.upsert({
      where: { sourceConnectionId_kind: { sourceConnectionId, kind } },
      update: {},
      create: { sourceConnectionId, kind, allowed: DOCUMENT_DEFS[kind].defaultAllowed },
    });
  }
}

export async function loadAllowedDocumentKinds(sourceConnectionId: string): Promise<Set<DocumentKind>> {
  const rows = await prisma.documentPolicy.findMany({ where: { sourceConnectionId, allowed: true }, select: { kind: true } });
  return new Set(rows.map((r) => r.kind as DocumentKind));
}

export async function loadAllowedFields(sourceConnectionId: string): Promise<Set<FieldKey>> {
  const rows = await prisma.fieldPolicy.findMany({ where: { sourceConnectionId, allowed: true }, select: { fieldKey: true } });
  return new Set(rows.map((r) => r.fieldKey).filter((k): k is FieldKey => (FIELD_KEYS as string[]).includes(k)));
}
