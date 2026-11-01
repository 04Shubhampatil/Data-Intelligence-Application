import "server-only";
import { DOCUMENT_DEFS, type DocumentKind } from "@di/core";
import { prisma } from "@di/db";
import type { CurrentUser } from "@/server/auth/session";
import { candidateScope } from "@/server/auth/scope";
import { hasPermission } from "@/lib/rbac";
import { signDocumentUrl } from "@/server/documents/signing";

export type DocumentView = {
  id: string;
  kind: DocumentKind;
  label: string;
  status: string;
  originalName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  scanStatus: string | null;
  extractedAt: Date;
  /** Signed, user-bound, 10-minute links. Only present for STORED files. */
  previewUrl?: string;
  downloadUrl?: string;
  identity: boolean;
};

/** Kinds this user may see: identity/bank kinds need the extra permission. */
export function visibleKinds(user: CurrentUser): DocumentKind[] {
  const canIdentity = hasPermission(user.permissions, "documents:read_identity");
  return (Object.keys(DOCUMENT_DEFS) as DocumentKind[]).filter((k) => canIdentity || !DOCUMENT_DEFS[k].identity);
}

/** Documents of one candidate, already filtered by scope and permission. */
export async function listCandidateDocuments(candidateId: string, user: CurrentUser): Promise<DocumentView[]> {
  if (!hasPermission(user.permissions, "documents:read")) return [];
  const rows = await prisma.candidateDocument.findMany({
    where: { candidateId, kind: { in: visibleKinds(user) }, candidate: { ...candidateScope(user), isDeletedAtSource: false } },
    orderBy: { kind: "asc" },
  });
  return rows.map((d) => ({
    id: d.id,
    kind: d.kind as DocumentKind,
    label: DOCUMENT_DEFS[d.kind as DocumentKind]?.label ?? d.kind,
    status: d.status,
    originalName: d.originalName,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    scanStatus: d.scanStatus,
    extractedAt: d.extractedAt,
    identity: DOCUMENT_DEFS[d.kind as DocumentKind]?.identity ?? false,
    ...(d.status === "STORED" && d.storageKey
      ? { previewUrl: signDocumentUrl(d.id, user.id, { inline: true }), downloadUrl: signDocumentUrl(d.id, user.id) }
      : {}),
  }));
}

/** One document for serving. Returns null (→ 404) when out of scope, not permitted, or not stored. */
export async function getServableDocument(docId: string, user: CurrentUser) {
  if (!hasPermission(user.permissions, "documents:read")) return null;
  const d = await prisma.candidateDocument.findFirst({
    where: { id: docId, status: "STORED", kind: { in: visibleKinds(user) }, candidate: { ...candidateScope(user), isDeletedAtSource: false } },
    include: { candidate: { select: { id: true, districtId: true, sourceEmployeeCode: true } } },
  });
  return d?.storageKey ? d : null;
}
