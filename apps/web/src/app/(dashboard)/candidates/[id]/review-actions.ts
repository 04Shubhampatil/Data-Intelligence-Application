"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { addComment, confirmReview, decideCandidate, ReviewError } from "@/server/services/review.service";
import { rateLimit } from "@/server/security/rate-limit";
import { decisionWord } from "@/lib/review-labels";

const TOO_FAST: ReviewActionState = { error: "Too many actions in a short time. Please wait a few minutes." };

export type ReviewActionState = { ok?: boolean; error?: string; message?: string } | undefined;
const id = z.string().regex(/^[a-z0-9]{1,40}$/i);

function fail(err: unknown): ReviewActionState {
  if (err instanceof ReviewError) return { error: err.message };
  console.error("[review]", err instanceof Error ? err.message : err);
  return { error: "Something went wrong. Please try again." };
}

const decideSchema = z.object({ candidateId: id, decision: z.enum(["SELECTED", "REJECTED"]), remark: z.string().max(2000).default("") });

export async function decideAction(_prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const user = await requireUser("reviews:decide");
  if (!rateLimit(`review:decide:${user.id}`, 120, 10 * 60_000).ok) return TOO_FAST;
  const parsed = decideSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Please check the form." };
  try {
    const r = await decideCandidate({ ...parsed.data, user });
    revalidatePath(`/candidates/${parsed.data.candidateId}`);
    revalidatePath("/candidates");
    return {
      ok: true,
      message: r.requiresConfirmation
        ? `Marked as ${decisionWord(r.decision)} — awaiting District Admin confirmation.`
        : `Candidate ${decisionWord(r.decision)}${r.isOverride ? " (previous decision overridden)" : ""}.`,
    };
  } catch (err) {
    return fail(err);
  }
}

export async function confirmAction(reviewId: string, candidateId: string): Promise<ReviewActionState> {
  const user = await requireUser("reviews:confirm");
  if (!rateLimit(`review:confirm:${user.id}`, 120, 10 * 60_000).ok) return TOO_FAST;
  try {
    await confirmReview(id.parse(reviewId), user);
    revalidatePath(`/candidates/${id.parse(candidateId)}`);
    revalidatePath("/candidates");
    return { ok: true, message: "Decision confirmed." };
  } catch (err) {
    return fail(err);
  }
}

const commentSchema = z.object({ candidateId: id, body: z.string().max(2000) });

export async function commentAction(_prev: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  const user = await requireUser("comments:write");
  if (!rateLimit(`review:comment:${user.id}`, 40, 10 * 60_000).ok) return TOO_FAST;
  const parsed = commentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Please check the comment." };
  try {
    await addComment({ ...parsed.data, user });
    revalidatePath(`/candidates/${parsed.data.candidateId}`);
    return { ok: true, message: "Comment added." };
  } catch (err) {
    return fail(err);
  }
}
