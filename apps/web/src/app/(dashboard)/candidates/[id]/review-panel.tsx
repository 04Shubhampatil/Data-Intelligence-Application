"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { CheckCircle2, Loader2, MessageSquarePlus, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ReviewStatusBadge } from "@/components/review-status-badge";
import { commentAction, confirmAction, decideAction, type ReviewActionState } from "./review-actions";

type Props = {
  candidateId: string;
  candidateName: string;
  status: string;
  updated: boolean;
  pendingConfirmation: boolean;
  pendingReviewId: string | null;
  can: { decide: boolean; override: boolean; confirm: boolean; comment: boolean };
  isDistrictViewer: boolean;
  twoStep: boolean;
};

function useToast(state: ReviewActionState) {
  useEffect(() => {
    if (state?.ok) toast.success(state.message);
    else if (state?.error) toast.error(state.error);
  }, [state]);
}

export function ReviewPanel(p: Props) {
  const [state, action, pending] = useActionState(decideAction, undefined);
  const [open, setOpen] = useState<"SELECTED" | "REJECTED" | null>(null);
  const [remark, setRemark] = useState("");
  useToast(state);
  useEffect(() => {
    if (state?.ok) {
      setOpen(null);
      setRemark("");
    }
  }, [state]);

  const decided = p.status !== "PENDING_REVIEW";
  const canAct = p.can.decide && (!decided || p.can.override);
  const rejectNeedsRemark = open === "REJECTED" && remark.trim().length < 3;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Review <ReviewStatusBadge status={p.status} updated={p.updated} pendingConfirmation={p.pendingConfirmation} />
        </CardTitle>
        <CardDescription>
          Decisions are made by people and kept as a permanent history. {decided && !p.can.override && p.can.decide ? "Changing a decision requires the override permission." : ""}
          {p.isDistrictViewer && p.twoStep ? " Your decisions are sent to the District Admin for confirmation." : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {p.can.decide && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setOpen("SELECTED")} disabled={!canAct || pending} className="bg-success text-success-foreground hover:bg-success/90">
              <CheckCircle2 /> {decided ? "Change to Selected" : "Select candidate"}
            </Button>
            <Button variant="destructive" onClick={() => setOpen("REJECTED")} disabled={!canAct || pending}>
              <XCircle /> {decided ? "Change to Rejected" : "Reject candidate"}
            </Button>
            {p.pendingConfirmation && p.pendingReviewId && p.can.confirm && <ConfirmButton reviewId={p.pendingReviewId} candidateId={p.candidateId} />}
          </div>
        )}
        {!p.can.decide && <p className="text-sm text-muted-foreground">Your role can view decisions but not make them.</p>}

        {p.can.comment && <CommentForm candidateId={p.candidateId} />}

        <AlertDialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
          <AlertDialogContent>
            <form action={action}>
              <input type="hidden" name="candidateId" value={p.candidateId} />
              <input type="hidden" name="decision" value={open ?? ""} />
              <AlertDialogHeader>
                <AlertDialogTitle>{open === "SELECTED" ? "Select" : "Reject"} {p.candidateName}?</AlertDialogTitle>
                <AlertDialogDescription>
                  {decided ? "This replaces the current decision. The earlier decision stays in the history. " : ""}
                  {open === "REJECTED" ? "A reason is required for rejection." : "You can add an optional comment."}
                  {p.isDistrictViewer && p.twoStep ? " The decision will wait for District Admin confirmation." : ""}
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
                  Confirm {open === "SELECTED" ? "selection" : "rejection"}
                </Button>
              </AlertDialogFooter>
            </form>
          </AlertDialogContent>
        </AlertDialog>
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
      {pending ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Confirm viewer decision
    </Button>
  );
}

function CommentForm({ candidateId }: { candidateId: string }) {
  const [state, action, pending] = useActionState(commentAction, undefined);
  const [body, setBody] = useState("");
  useToast(state);
  useEffect(() => {
    if (state?.ok) setBody("");
  }, [state]);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="candidateId" value={candidateId} />
      <Label htmlFor="comment">Add a review comment (internal; never shown to the candidate)</Label>
      <Textarea id="comment" name="body" value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={2000} placeholder="e.g. Certificates checked, experience letter missing" className="bg-card" />
      <Button type="submit" size="sm" variant="outline" disabled={pending || body.trim().length < 2}>
        {pending ? <Loader2 className="animate-spin" /> : <MessageSquarePlus />} Add comment
      </Button>
    </form>
  );
}
