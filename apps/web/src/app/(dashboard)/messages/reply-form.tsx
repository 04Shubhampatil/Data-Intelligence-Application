"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2, Reply } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { replyMessageAction } from "./message-actions";

export function ReplyForm({ parentId }: { parentId: string }) {
  const [state, action, pending] = useActionState(replyMessageAction, undefined);
  const [body, setBody] = useState("");
  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message);
      setBody("");
    } else if (state?.error) toast.error(state.error);
  }, [state]);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="parentId" value={parentId} />
      <Label htmlFor="reply-body">Reply</Label>
      <Textarea id="reply-body" name="body" value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={5000} className="bg-card" placeholder="Write a reply to everyone in this thread" />
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending || body.trim().length < 2}>
          {pending ? <Loader2 className="animate-spin" /> : <Reply />} Send reply
        </Button>
      </div>
    </form>
  );
}
