import { z } from "zod";
import { authorizeApi } from "@/server/auth/session";
import { addComment, getReviewTimeline } from "@/server/services/review.service";
import { rateLimit } from "@/server/security/rate-limit";
import { audit } from "@/server/security/audit";
import { isId, rejectCrossSite, reviewErrorResponse } from "@/server/api/review-http";

/**
 * GET /api/candidates/:id/comments — read-only review history (decisions + internal comments)
 * for any role with reviews:read, inside the user's districts. Outside the scope: 404.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/candidates/[id]/comments">) {
  const { user, error } = await authorizeApi("reviews:read");
  if (error) return error;
  const { id } = await ctx.params;
  if (!isId(id)) return Response.json({ error: "Not found." }, { status: 404 });
  const { prisma } = await import("@di/db");
  const { candidateScope } = await import("@/server/auth/scope");
  const inScope = await prisma.candidate.findFirst({ where: { id, ...candidateScope(user), isDeletedAtSource: false }, select: { reviewStatus: true, reviewedAt: true } });
  if (!inScope) return Response.json({ error: "Not found." }, { status: 404 });
  const t = await getReviewTimeline(id, user);
  const who = (u: { name: string | null; username: string }) => u.name ?? u.username;
  return Response.json(
    {
      status: inScope.reviewStatus,
      decidedAt: inScope.reviewedAt,
      decisions: t.reviews.map((r) => ({ decision: r.decision, remark: r.remark, by: who(r.reviewedBy), byRole: r.reviewedBy.role.name, at: r.createdAt, changedFrom: r.isOverride ? r.previousStatus : null })),
      comments: t.comments.map((c) => ({ body: c.body, by: who(c.author), at: c.createdAt })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

const bodySchema = z.object({ body: z.string().max(2000) }).strict();

/** POST /api/candidates/:id/comments { body } — Super Admin only; 403 for every other role. Comments are append-only. */
export async function POST(request: Request, ctx: RouteContext<"/api/candidates/[id]/comments">) {
  const { user, error } = await authorizeApi("reviews:read");
  if (error) return error;
  const { id } = await ctx.params;
  if (user.role !== "SUPER_ADMIN") {
    await audit("ACCESS_DENIED", { userId: user.id, target: isId(id) ? id : undefined, metadata: { context: "review_api", action: "comment", role: user.role } });
    return Response.json({ error: "Only the Super Admin can add review comments." }, { status: 403 });
  }
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  if (!isId(id)) return Response.json({ error: "Not found." }, { status: 404 });
  if (!rateLimit(`review:comment:${user.id}`, 40, 10 * 60_000).ok) return Response.json({ error: "Too many requests." }, { status: 429 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request: send { body: string }." }, { status: 400 });
  try {
    const c = await addComment({ candidateId: id, body: parsed.data.body, user });
    return Response.json({ ok: true, commentId: c.id, at: c.createdAt }, { status: 201 });
  } catch (err) {
    return reviewErrorResponse(err);
  }
}
