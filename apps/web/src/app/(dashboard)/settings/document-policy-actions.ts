"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DOCUMENT_DEFS, isDocumentKind } from "@di/core";
import { prisma } from "@di/db";
import { requireUser } from "@/server/auth/session";
import { audit } from "@/server/security/audit";

export async function setDocumentPolicyAction(sourceId: string, kind: string, allowed: boolean) {
  const user = await requireUser("settings:write");
  const sid = z.string().regex(/^[a-z0-9]{1,40}$/i).parse(sourceId);
  if (!isDocumentKind(kind)) return { error: "Unknown document kind." };
  // One decision for every source connection, so a document kind is never collected through another one.
  const sources = await prisma.sourceConnection.findMany({ where: { adapterKey: { not: "synthetic" } }, select: { id: true } });
  const ids = new Set([sid, ...sources.map((s) => s.id)]);
  for (const sourceConnectionId of ids) {
    await prisma.documentPolicy.upsert({
      where: { sourceConnectionId_kind: { sourceConnectionId, kind } },
      update: { allowed },
      create: { sourceConnectionId, kind, allowed },
    });
  }
  await audit("SETTINGS_UPDATE", { userId: user.id, target: `documents:${kind}`, metadata: { allowed, identity: DOCUMENT_DEFS[kind].identity } });
  revalidatePath("/settings");
  return { ok: true, message: `${DOCUMENT_DEFS[kind].label}: ${allowed ? "will be collected on the next sync" : "no longer collected (existing copies are kept until erased)"}.` };
}
