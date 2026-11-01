"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Megaphone, Send } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { roleLabel } from "@/lib/format";
import { sendMessageAction } from "./message-actions";

export type ComposeDistrict = { id: string; name: string; users: { id: string; label: string; role: string }[] };

const KINDS = [
  { value: "MESSAGE", label: "Message" },
  { value: "ANNOUNCEMENT", label: "Announcement" },
  { value: "REMINDER", label: "Reminder" },
] as const;

/** Compose a message / announcement / reminder to the users of one district. */
export function ComposeDialog({ districts, compact }: { districts: ComposeDistrict[]; compact?: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(sendMessageAction, undefined);
  const [open, setOpen] = useState(false);
  const [districtId, setDistrictId] = useState(districts[0]?.id ?? "");
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("MESSAGE");
  const [everyone, setEveryone] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const district = districts.find((d) => d.id === districtId);

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message);
      setOpen(false);
      setPicked([]);
      setEveryone(true);
      if (state.threadId) router.push(`/messages/${state.threadId}`);
    } else if (state?.error) toast.error(state.error);
  }, [state, router]);

  if (!districts.length) return null;

  return (
    <>
      <Button size={compact ? "sm" : "default"} onClick={() => setOpen(true)}>
        <Megaphone /> New message
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="max-w-lg">
          <form action={action} className="space-y-4">
            <input type="hidden" name="districtId" value={districtId} />
            <input type="hidden" name="kind" value={kind} />
            {!everyone && picked.map((id) => <input key={id} type="hidden" name="recipientIds" value={id} />)}
            <AlertDialogHeader>
              <AlertDialogTitle>New district message</AlertDialogTitle>
              <AlertDialogDescription>Recipients are limited to users assigned to the district. Each recipient gets a notification and a read receipt is kept.</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cm-district">District</Label>
                <Select value={districtId} onValueChange={(v) => { setDistrictId(v); setPicked([]); }}>
                  <SelectTrigger id="cm-district" className="w-full bg-card"><SelectValue /></SelectTrigger>
                  <SelectContent>{districts.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cm-kind">Type</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
                  <SelectTrigger id="cm-kind" className="w-full bg-card"><SelectValue /></SelectTrigger>
                  <SelectContent>{KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cm-subject">Subject</Label>
              <Input id="cm-subject" name="subject" required minLength={2} maxLength={200} className="bg-card" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cm-body">Message</Label>
              <Textarea id="cm-body" name="body" required minLength={2} maxLength={5000} rows={5} className="bg-card" />
            </div>
            <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={everyone} onCheckedChange={(v) => setEveryone(v === true)} /> Everyone assigned to {district?.name ?? "the district"} ({district?.users.length ?? 0})
              </label>
              {!everyone && (
                <div className="max-h-40 space-y-1 overflow-y-auto pl-1 text-sm">
                  {district?.users.length ? (
                    district.users.map((u) => (
                      <label key={u.id} className="flex items-center gap-2">
                        <Checkbox checked={picked.includes(u.id)} onCheckedChange={(v) => setPicked((p) => (v === true ? [...p, u.id] : p.filter((x) => x !== u.id)))} />
                        <span>{u.label}</span>
                        <span className="text-xs text-muted-foreground">{roleLabel(u.role)}</span>
                      </label>
                    ))
                  ) : (
                    <p className="text-muted-foreground">Nobody is assigned to this district yet.</p>
                  )}
                </div>
              )}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={pending}>Cancel</AlertDialogCancel>
              <Button type="submit" disabled={pending || !district?.users.length || (!everyone && picked.length === 0)}>
                {pending ? <Loader2 className="animate-spin" /> : <Send />} Send
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
