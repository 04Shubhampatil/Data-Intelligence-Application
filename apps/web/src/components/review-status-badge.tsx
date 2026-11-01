import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STYLES: Record<string, { label: string; className: string }> = {
  PENDING_REVIEW: { label: "Pending review", className: "bg-muted text-muted-foreground" },
  SELECTED: { label: "Selected", className: "bg-success/10 text-success" },
  REJECTED: { label: "Rejected", className: "bg-destructive/10 text-destructive" },
};

export function ReviewStatusBadge({ status, updated, pendingConfirmation, className }: { status: string; updated?: boolean; pendingConfirmation?: boolean; className?: string }) {
  const s = STYLES[status] ?? { label: status, className: "bg-muted text-muted-foreground" };
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      <Badge className={cn("border-0 font-semibold", s.className)}>{s.label}</Badge>
      {pendingConfirmation && <Badge className="border-0 bg-brand-orange/15 text-brand-orange">Awaiting confirmation</Badge>}
      {updated && !pendingConfirmation && <Badge variant="outline">Decision updated</Badge>}
    </span>
  );
}
