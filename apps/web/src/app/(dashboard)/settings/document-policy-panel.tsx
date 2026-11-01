"use client";

import { useTransition } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { setDocumentPolicyAction } from "./document-policy-actions";

type Row = { kind: string; label: string; identity: boolean; allowed: boolean };

/** Which document kinds the sync may copy from the source. Identity/bank kinds are flagged. */
export function DocumentPolicyPanel({ sourceId, rows, canEdit }: { sourceId: string; rows: Row[]; canEdit: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents collected from the source</CardTitle>
        <CardDescription>Only ticked kinds are ever downloaded. Identity and bank documents stay off unless the data owner has approved them in writing.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y text-sm" role="list">
          {rows.map((r) => (
            <li key={r.kind} className="flex items-center justify-between gap-3 py-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">{r.label}</span>
                {r.identity && (
                  <Badge className="border-0 bg-brand-orange/15 text-brand-orange">
                    <ShieldAlert className="mr-1 size-3" /> identity / financial
                  </Badge>
                )}
              </div>
              <Checkbox
                checked={r.allowed}
                disabled={!canEdit || pending}
                aria-label={`Collect ${r.label}`}
                onCheckedChange={(c) =>
                  start(async () => {
                    const res = await setDocumentPolicyAction(sourceId, r.kind, c === true);
                    if (res?.ok) toast.success(res.message);
                    else if (res?.error) toast.error(res.error);
                  })
                }
              />
            </li>
          ))}
        </ul>
        {pending && <p className="mt-2 text-xs text-muted-foreground"><Loader2 className="mr-1 inline size-3 animate-spin" /> Saving…</p>}
      </CardContent>
    </Card>
  );
}
