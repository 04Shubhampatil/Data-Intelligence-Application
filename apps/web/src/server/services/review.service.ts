import "server-only";
import { prisma, type ReviewDecision, type ReviewStatus } from "@di/db";
import type { CurrentUser } from "@/server/auth/session";
import { candidateScope } from "@/server/auth/scope";
import { hasPermission } from "@/lib/rbac";
import { audit } from "@/server/security/audit";
import { districtAdminIds, notifyUsers } from "./notification.service";

export class ReviewError extends Error {
  constructor(message: string, public code: "NOT_FOUND" | "FORBIDDEN" | "INVALID" | "CONFLICT" = "INVALID") {
    super(message);
  }
}

/** Two-step confirmation for District Viewer decisions. Default on; a Super Admin can switch it off (SystemStatus "review:twoStep"). */
export async function twoStepEnabled(): Promise<boolean> {
  const row = await prisma.systemStatus.findUnique({ where: { key: "review:twoStep" } });
  return row ? (row.value as { enabled?: boolean }).enabled !== false : true;
}

/** Loads a candidate the user may act on (scope-enforced) or throws NOT_FOUND. */
async function loadInScope(candidateId: string, user: CurrentUser) {
  const c = await prisma.candidate.findFirst({
    where: { id: candidateId, isDeletedAtSource: false, ...candidateScope(user) },
    select: { id: true, districtId: true, reviewStatus: true, reviewPendingConfirmation: true, sourceEmployeeCode: true },
  });
  if (!c) throw new ReviewError("Record not found.", "NOT_FOUND");
  return c;
}

/**
 * Records a human decision. Rules:
 *  - reviews:decide required; district scope enforced;
 *  - a remark is required for REJECTED;
 *  - once a candidate has a decision, changing it requires reviews:override (and is marked as an override);
 *  - District Viewer decisions wait for confirmation when two-step is on;
 *  - every decision is a new row — nothing is overwritten.
 */
export async function decideCandidate(opts: { candidateId: string; decision: ReviewDecision; remark: string; user: CurrentUser }) {
  const { user } = opts;
  if (!hasPermission(user.permissions, "reviews:decide")) throw new ReviewError("You are not allowed to decide on candidates.", "FORBIDDEN");
  const remark = opts.remark.trim();
  if (opts.decision === "REJECTED" && remark.length < 3) throw new ReviewError("A reason is required to reject a candidate.");
  if (remark.length > 2000) throw new ReviewError("Remark is too long (max 2000 characters).");

  const c = await loadInScope(opts.candidateId, user);
  const previousStatus: ReviewStatus = c.reviewStatus;
  const alreadyDecided = previousStatus !== "PENDING_REVIEW";
  if (alreadyDecided && !hasPermission(user.permissions, "reviews:override")) {
    throw new ReviewError("This candidate already has a decision. Changing it requires the override permission.", "CONFLICT");
  }
  if (alreadyDecided && previousStatus === opts.decision && !c.reviewPendingConfirmation) {
    throw new ReviewError(`This candidate is already ${opts.decision.toLowerCase()}.`, "CONFLICT");
  }

  const requiresConfirmation = user.role === "DISTRICT_VIEWER" && (await twoStepEnabled());
  const latest = alreadyDecided ? await prisma.candidateReview.findFirst({ where: { candidateId: c.id }, orderBy: { createdAt: "desc" }, select: { id: true } }) : null;

  const review = await prisma.$transaction(async (tx) => {
    const r = await tx.candidateReview.create({
      data: {
        candidateId: c.id,
        decision: opts.decision,
        remark,
        previousStatus,
        newStatus: opts.decision,
        isOverride: alreadyDecided,
        overridesId: latest?.id ?? null,
        reviewedById: user.id,
        districtId: c.districtId,
        requiresConfirmation,
      },
    });
    await tx.candidate.update({
      where: { id: c.id },
      data: { reviewStatus: opts.decision, reviewUpdated: alreadyDecided, reviewPendingConfirmation: requiresConfirmation, reviewedAt: r.createdAt },
    });
    return r;
  });

  await audit(alreadyDecided ? "REVIEW_OVERRIDE" : "REVIEW_DECIDE", {
    userId: user.id,
    target: c.id,
    metadata: { decision: opts.decision, previousStatus, requiresConfirmation, reviewId: review.id },
  });

  // Bell notifications (never block the decision).
  const who = user.name ?? user.email;
  const link = `/candidates/${c.id}`;
  if (requiresConfirmation) {
    await notifyUsers(await districtAdminIds(c.districtId), { type: "REVIEW_AWAITING", title: `Decision awaiting confirmation: ${c.sourceEmployeeCode}`, body: `${who} marked the candidate as ${opts.decision.toLowerCase()}.`, link });
  }
  if (alreadyDecided && latest) {
    const prev = await prisma.candidateReview.findUnique({ where: { id: latest.id }, select: { reviewedById: true } });
    if (prev && prev.reviewedById !== user.id) {
      await notifyUsers([prev.reviewedById], { type: "REVIEW_OVERRIDDEN", title: `Decision changed: ${c.sourceEmployeeCode}`, body: `${who} changed the decision to ${opts.decision.toLowerCase()}.`, link });
    }
  }
  return review;
}

/** District Admin / Admin confirms a District Viewer decision. */
export async function confirmReview(reviewId: string, user: CurrentUser) {
  if (!hasPermission(user.permissions, "reviews:confirm")) throw new ReviewError("You are not allowed to confirm decisions.", "FORBIDDEN");
  const r = await prisma.candidateReview.findFirst({
    where: { id: reviewId, requiresConfirmation: true, confirmedAt: null, candidate: { ...candidateScope(user), isDeletedAtSource: false } },
    select: { id: true, candidateId: true, decision: true, reviewedById: true, candidate: { select: { sourceEmployeeCode: true } } },
  });
  if (!r) throw new ReviewError("Nothing to confirm.", "NOT_FOUND");
  if (r.reviewedById === user.id) throw new ReviewError("You cannot confirm your own decision.", "FORBIDDEN");
  await prisma.$transaction([
    prisma.candidateReview.update({ where: { id: r.id }, data: { confirmedById: user.id, confirmedAt: new Date() } }),
    prisma.candidate.update({ where: { id: r.candidateId }, data: { reviewPendingConfirmation: false } }),
  ]);
  await audit("REVIEW_CONFIRM", { userId: user.id, target: r.candidateId, metadata: { reviewId: r.id, decision: r.decision } });
  await notifyUsers([r.reviewedById], { type: "REVIEW_CONFIRMED", title: `Decision confirmed: ${r.candidate.sourceEmployeeCode}`, body: `${user.name ?? user.email} confirmed your ${r.decision.toLowerCase()} decision.`, link: `/candidates/${r.candidateId}` });
}

export async function addComment(opts: { candidateId: string; body: string; user: CurrentUser }) {
  if (!hasPermission(opts.user.permissions, "comments:write")) throw new ReviewError("You are not allowed to comment.", "FORBIDDEN");
  const body = opts.body.trim();
  if (body.length < 2) throw new ReviewError("Comment is empty.");
  if (body.length > 2000) throw new ReviewError("Comment is too long (max 2000 characters).");
  const c = await loadInScope(opts.candidateId, opts.user);
  const comment = await prisma.candidateComment.create({ data: { candidateId: c.id, authorId: opts.user.id, body } });
  await audit("COMMENT_ADD", { userId: opts.user.id, target: c.id, metadata: { commentId: comment.id } });
  return comment;
}

/** Decisions + comments as one chronological timeline (scope-enforced; empty for users without reviews:read). */
export async function getReviewTimeline(candidateId: string, user: CurrentUser) {
  if (!hasPermission(user.permissions, "reviews:read")) return { reviews: [], comments: [] };
  const inScope = await prisma.candidate.findFirst({ where: { id: candidateId, ...candidateScope(user) }, select: { id: true } });
  if (!inScope) return { reviews: [], comments: [] };
  const [reviews, comments] = await Promise.all([
    prisma.candidateReview.findMany({
      where: { candidateId },
      orderBy: { createdAt: "desc" },
      include: { reviewedBy: { select: { name: true, email: true, role: { select: { name: true } } } }, confirmedBy: { select: { name: true, email: true } } },
    }),
    prisma.candidateComment.findMany({ where: { candidateId }, orderBy: { createdAt: "desc" }, include: { author: { select: { name: true, email: true } } } }),
  ]);
  return { reviews, comments };
}
