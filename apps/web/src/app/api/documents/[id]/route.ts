import { LocalFileStorage } from "@di/core";
import { prisma } from "@di/db";
import { authorizeApi } from "@/server/auth/session";
import { getServableDocument } from "@/server/services/document.service";
import { verifyDocumentSignature } from "@/server/documents/signing";
import { audit } from "@/server/security/audit";
import { rateLimit } from "@/server/security/rate-limit";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * Serves a stored candidate document. Three gates, all server-side:
 *  1. signed-in user with documents:read (identity kinds also need documents:read_identity),
 *  2. a valid, unexpired signature bound to THIS user (links can't be shared),
 *  3. the candidate is inside the user's district scope (otherwise 404, and the probe is audited).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const { user, error } = await authorizeApi("documents:read");
  if (error) return error;
  const { id } = await ctx.params;
  if (!/^[a-z0-9]{1,40}$/i.test(id)) return notFound();
  if (!rateLimit(`docs:${user.id}`, 120, 10 * 60_000).ok) return new Response("Too many requests", { status: 429 });

  const url = new URL(request.url);
  const inline = url.searchParams.get("inline") === "1";
  if (!verifyDocumentSignature(id, user.id, url.searchParams.get("e"), url.searchParams.get("s"), inline)) return notFound();

  const doc = await getServableDocument(id, user);
  if (!doc) {
    const exists = await prisma.candidateDocument.findUnique({ where: { id }, select: { candidateId: true } });
    if (exists) await audit("ACCESS_DENIED", { userId: user.id, target: exists.candidateId, metadata: { context: "document", documentId: id } });
    return notFound();
  }

  let bytes: Uint8Array;
  try {
    bytes = await new LocalFileStorage().get(doc.storageKey!);
  } catch {
    return new Response("File unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  await audit("DOCUMENT_VIEW", { userId: user.id, target: doc.candidate.id, metadata: { documentId: id, kind: doc.kind, inline } });

  const safeName = doc.originalName.replace(/[^\w.\-]+/g, "_").slice(0, 80) || `${doc.kind}.bin`;
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": doc.mimeType ?? "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
