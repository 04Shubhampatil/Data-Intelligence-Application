import { CheckCircle2, MessageSquare, ShieldCheck, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, roleLabel } from "@/lib/format";

type Review = {
  id: string;
  decision: string;
  remark: string;
  previousStatus: string;
  newStatus: string;
  isOverride: boolean;
  requiresConfirmation: boolean;
  confirmedAt: Date | null;
  createdAt: Date;
  reviewedBy: { name: string | null; username: string; role: { name: string } };
  confirmedBy: { name: string | null; username: string } | null;
};
type Comment = { id: string; body: string; createdAt: Date; author: { name: string | null; username: string } };

/** Append-only history: decisions, confirmations and comments, newest first. */
export function ReviewTimeline({ reviews, comments }: { reviews: Review[]; comments: Comment[] }) {
  const items = [
    ...reviews.map((r) => ({ at: r.createdAt, kind: "review" as const, r })),
    ...comments.map((c) => ({ at: c.createdAt, kind: "comment" as const, c })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comments &amp; review history</CardTitle>
        <CardDescription>{items.length ? `${reviews.length} decision${reviews.length === 1 ? "" : "s"}, ${comments.length} comment${comments.length === 1 ? "" : "s"}. Entries are never edited or deleted.` : "No decisions or comments yet."}</CardDescription>
      </CardHeader>
      {items.length > 0 && (
        <CardContent>
          <ol className="relative space-y-4 border-l pl-5" role="list">
            {items.map((it) =>
              it.kind === "review" ? (
                <li key={it.r.id} className="relative">
                  <span className={`absolute -left-[27px] grid size-4 place-items-center rounded-full ${it.r.decision === "SELECTED" ? "bg-success text-white" : "bg-destructive text-white"}`}>
                    {it.r.decision === "SELECTED" ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
                  </span>
                  <p className="text-sm">
                    <span className="font-semibold">{it.r.reviewedBy.name ?? it.r.reviewedBy.username}</span>
                    <span className="text-muted-foreground"> ({roleLabel(it.r.reviewedBy.role.name)}) </span>
                    {it.r.isOverride ? "changed the decision to" : "marked the candidate"} <span className="font-semibold">{it.r.decision.toLowerCase()}</span>
                    {it.r.isOverride && <Badge variant="outline" className="ml-2">override</Badge>}
                    {it.r.requiresConfirmation && !it.r.confirmedAt && <Badge className="ml-2 border-0 bg-brand-orange/15 text-brand-orange">awaiting confirmation</Badge>}
                  </p>
                  {it.r.remark && <p className="mt-1 whitespace-pre-wrap rounded-lg bg-muted/60 px-3 py-2 text-sm">{it.r.remark}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(it.r.createdAt)} · {it.r.previousStatus.replace("_", " ").toLowerCase()} → {it.r.newStatus.toLowerCase()}
                    {it.r.confirmedAt && it.r.confirmedBy && (
                      <> · <ShieldCheck className="inline size-3" /> confirmed by {it.r.confirmedBy.name ?? it.r.confirmedBy.username} on {formatDateTime(it.r.confirmedAt)}</>
                    )}
                  </p>
                </li>
              ) : (
                <li key={it.c.id} className="relative">
                  <span className="absolute -left-[27px] grid size-4 place-items-center rounded-full bg-brand-navy text-white"><MessageSquare className="size-3" /></span>
                  <p className="text-sm"><span className="font-semibold">{it.c.author.name ?? it.c.author.username}</span> <span className="text-muted-foreground">commented</span></p>
                  <p className="mt-1 whitespace-pre-wrap rounded-lg bg-muted/60 px-3 py-2 text-sm">{it.c.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(it.c.createdAt)}</p>
                </li>
              ),
            )}
          </ol>
        </CardContent>
      )}
    </Card>
  );
}
