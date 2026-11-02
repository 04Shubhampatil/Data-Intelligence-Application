import { z } from "zod";
import { authorizeApi } from "@/server/auth/session";
import { isDecisionRole } from "@di/db/permissions";
import { decideCandidate } from "@/server/services/review.service";
import { rateLimit } from "@/server/security/rate-limit";
import { audit } from "@/server/security/audit";
import { isId, rejectCrossSite, reviewErrorResponse } from "@/server/api/review-http";

const bodySchema = z.object({ decision: z.enum(["SELECTED", "REJECTED"]), remark: z.string().max(2000).default("") }).strict();

/**
 * POST /api/candidates/:id/decision  { decision: "SELECTED" | "REJECTED", remark?: string }
 * Super Admin, or District Admin for candidates in their own districts (others answer 404). Every other role gets 403 (and the attempt is audit-logged), regardless
 * of what their role's permission list says. District scope and decision rules are enforced
 * by the same service the UI uses; decisions are appended to the history, never overwritten.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/candidates/[id]/decision">) {
  const { user, error } = await authorizeApi("reviews:read");
  if (error) return error;
  const { id } = await ctx.params;
  if (!isDecisionRole(user.role)) {
    await audit("ACCESS_DENIED", { userId: user.id, target: isId(id) ? id : undefined, metadata: { context: "review_api", action: "decide", role: user.role } });
    return Response.json({ error: "Only the Super Admin or a District Admin can select or reject candidates." }, { status: 403 });
  }
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  if (!isId(id)) return Response.json({ error: "Not found." }, { status: 404 });
  if (!rateLimit(`review:decide:${user.id}`, 120, 10 * 60_000).ok) return Response.json({ error: "Too many requests." }, { status: 429 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request: send { decision: 'SELECTED' | 'REJECTED', remark?: string }." }, { status: 400 });
  try {
    const r = await decideCandidate({ candidateId: id, decision: parsed.data.decision, remark: parsed.data.remark, user });
    return Response.json({ ok: true, reviewId: r.id, status: r.newStatus, changedFrom: r.isOverride ? r.previousStatus : null, decidedAt: r.createdAt });
  } catch (err) {
    return reviewErrorResponse(err);
  }
}
