"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { CheckCircle2, Eye, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ReviewStatusBadge } from "@/components/review-status-badge";
import { confirmAction, decideAction, type ReviewActionState } from "./review-actions";
import { decisionLabel } from "@/lib/review-labels";

type Props = {
  candidateId: string;
  candidateName: string;
  status: string;
  updated: boolean;
  pendingConfirmation: boolean;
  pendingReviewId: string | null;
  /** Super Admin, or District Admin in their districts (server-computed); everyone else gets a read-only card. */
  can: { decide: boolean; override: boolean; confirm: boolean; comment: boolean };
  /** Latest decision, shown to every role that can read reviews. */
  latest: { decision: "SELECTED" | "REJECTED"; by: string; byRole: string; at: string; remark: string | null } | null;
  /** "banner": only the Select / Reject buttons (+ dialog), styled for the dark profile banner. */
  variant?: "card" | "banner";
};

function useToast(state: ReviewActionState) {
  useEffect(() => {
    if (state?.ok) toast.success(state.message);
    else if (state?.error) toast.error(state.error);
  }, [state]);
}

export function ReviewPanel(p: Props) {
  const [open, setOpen] = useState<"SELECTED" | "REJECTED" | null>(null);
  const [remark, setRemark] = useState("");
  const [state, action, pending] = useActionState(async (prev: ReviewActionState, fd: FormData) => {
    const r = await decideAction(prev, fd);
    if (r?.ok) {
      setOpen(null);
      setRemark("");
    }
    return r;
  }, undefined);
  useToast(state);

  const decided = p.status !== "PENDING_REVIEW";
  const canAct = p.can.decide && (!decided || p.can.override);
  const rejectNeedsRemark = open === "REJECTED" && remark.trim().length < 3;

  const dialog = (
        <AlertDialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
      <AlertDialogContent>
        <form action={action}>
          <input type="hidden" name="candidateId" value={p.candidateId} />
          <input type="hidden" name="decision" value={open ?? ""} />
          <AlertDialogHeader>
            <AlertDialogTitle>{open === "SELECTED" ? "Verify" : "Reject"} {p.candidateName}?</AlertDialogTitle>
            <AlertDialogDescription>
              {decided ? "This replaces the current decision. The earlier decision stays in the history. " : ""}
              {open === "REJECTED" ? "A reason is required for rejection." : "You can add an optional comment."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="my-4 space-y-1.5">
            <Label htmlFor="remark">{open === "REJECTED" ? "Reason (required)" : "Comment (optional)"}</Label>
            <Textarea id="remark" name="remark" value={remark} onChange={(e) => setRemark(e.target.value)} rows={3} maxLength={2000} className="bg-card" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={pending}>Cancel</AlertDialogCancel>
            {/* Plain submit (not AlertDialogAction): the dialog must stay mounted until the server action has read the form. */}
            <Button type="submit" disabled={pending || rejectNeedsRemark} className={open === "REJECTED" ? "bg-destructive text-white hover:bg-destructive/90" : "bg-success text-success-foreground hover:bg-success/90"}>
              {pending ? <Loader2 className="animate-spin" /> : open === "SELECTED" ? <CheckCircle2 /> : <XCircle />}
              Confirm {open === "SELECTED" ? "verification" : "rejection"}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (p.variant === "banner") {
    if (!p.can.decide) return null;
    return (
      <div className="flex flex-wrap gap-2.5">
        <Button onClick={() => setOpen("SELECTED")} disabled={!canAct || pending} className="h-10 rounded-xl bg-emerald-600 px-4 text-white shadow-md shadow-emerald-950/30 hover:bg-emerald-500">
          <CheckCircle2 /> {decided ? "Change to Verified" : "Verify Candidate"}
        </Button>
        <Button onClick={() => setOpen("REJECTED")} disabled={!canAct || pending} className="h-10 rounded-xl bg-red-600 px-4 text-white shadow-md shadow-red-950/30 hover:bg-red-500">
          <XCircle /> {decided ? "Change to Rejected" : "Reject Candidate"}
        </Button>
        {p.pendingConfirmation && p.pendingReviewId && p.can.confirm && <ConfirmButton reviewId={p.pendingReviewId} candidateId={p.candidateId} />}
        {dialog}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Review <ReviewStatusBadge status={p.status} updated={p.updated} pendingConfirmation={p.pendingConfirmation} />
        </CardTitle>
        <CardDescription>
          {p.can.decide
            ? "Decisions are kept as a permanent history; changing one adds a new entry."
            : "Read-only. Candidate decisions are made by the Super Admin or the District Admin."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {p.latest ? (
          <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
            <p>
              <span className={p.latest.decision === "SELECTED" ? "font-semibold text-success" : "font-semibold text-destructive"}>
                {decisionLabel(p.latest.decision)}
              </span>{" "}
              by <span className="font-medium">{p.latest.by}</span> <span className="text-muted-foreground">({p.latest.byRole})</span> on {p.latest.at}
            </p>
            {p.latest.remark && <p className="mt-1.5 whitespace-pre-wrap text-muted-foreground">“{p.latest.remark}”</p>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Pending — no decision has been made yet.</p>
        )}

        {p.can.decide && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setOpen("SELECTED")} disabled={!canAct || pending} className="bg-success text-success-foreground hover:bg-success/90">
              <CheckCircle2 /> {decided ? "Change to Verified" : "Verify candidate"}
            </Button>
            <Button variant="destructive" onClick={() => setOpen("REJECTED")} disabled={!canAct || pending}>
              <XCircle /> {decided ? "Change to Rejected" : "Reject candidate"}
            </Button>
            {p.pendingConfirmation && p.pendingReviewId && p.can.confirm && <ConfirmButton reviewId={p.pendingReviewId} candidateId={p.candidateId} />}
          </div>
        )}
        {!p.can.decide && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Eye className="size-3.5" /> You can view the decision, comments and history below but not change them.
          </p>
        )}


        {dialog}
      </CardContent>
    </Card>
  );
}

function ConfirmButton({ reviewId, candidateId }: { reviewId: string; candidateId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await confirmAction(reviewId, candidateId);
          if (r?.ok) toast.success(r.message);
          else if (r?.error) toast.error(r.error);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Confirm pending decision
    </Button>
  );
}
