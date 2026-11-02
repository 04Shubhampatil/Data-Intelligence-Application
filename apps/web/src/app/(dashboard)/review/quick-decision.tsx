"use client";

import { useActionState, useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { decideAction } from "@/app/(dashboard)/candidates/[id]/review-actions";

/** Select / Reject straight from the viewer's list. Same server action and rules as the detail page. */
export function QuickDecision({ candidateId, candidateName, disabled, twoStep }: { candidateId: string; candidateName: string; disabled: boolean; twoStep: boolean }) {
  const [open, setOpen] = useState<"SELECTED" | "REJECTED" | null>(null);
  const [remark, setRemark] = useState("");
  const [state, action, pending] = useActionState(async (prev: Parameters<typeof decideAction>[0], fd: FormData) => {
    const r = await decideAction(prev, fd);
    if (r?.ok) {
      setOpen(null);
      setRemark("");
    }
    return r;
  }, undefined);
  useEffect(() => {
    if (state?.ok) toast.success(state.message);
    else if (state?.error) toast.error(state.error);
  }, [state]);
  const needsRemark = open === "REJECTED" && remark.trim().length < 3;

  return (
    <>
      <div className="flex gap-1.5">
        <Button size="sm" variant="outline" disabled={disabled || pending} onClick={() => setOpen("SELECTED")} className="text-success hover:bg-success/10">
          <CheckCircle2 /> Select
        </Button>
        <Button size="sm" variant="outline" disabled={disabled || pending} onClick={() => setOpen("REJECTED")} className="text-destructive hover:bg-destructive/10">
          <XCircle /> Reject
        </Button>
      </div>
      <AlertDialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <AlertDialogContent>
          <form action={action}>
            <input type="hidden" name="candidateId" value={candidateId} />
            <input type="hidden" name="decision" value={open ?? ""} />
            <AlertDialogHeader>
              <AlertDialogTitle>{open === "SELECTED" ? "Select" : "Reject"} {candidateName}?</AlertDialogTitle>
              <AlertDialogDescription>
                {open === "REJECTED" ? "A reason is required for rejection." : "You can add an optional comment."}
                {twoStep ? " The decision will wait for District Admin confirmation." : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="my-4 space-y-1.5">
              <Label htmlFor={`qd-${candidateId}`}>{open === "REJECTED" ? "Reason (required)" : "Comment (optional)"}</Label>
              <Textarea id={`qd-${candidateId}`} name="remark" value={remark} onChange={(e) => setRemark(e.target.value)} rows={3} maxLength={2000} className="bg-card" />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={pending}>Cancel</AlertDialogCancel>
              <Button type="submit" disabled={pending || needsRemark} className={open === "REJECTED" ? "bg-destructive text-white hover:bg-destructive/90" : "bg-success text-success-foreground hover:bg-success/90"}>
                {pending ? <Loader2 className="animate-spin" /> : open === "SELECTED" ? <CheckCircle2 /> : <XCircle />} Confirm
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
