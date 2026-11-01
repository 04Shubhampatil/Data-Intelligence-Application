import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STYLES: Record<string, { label: string; className: string }> = {
  QUEUED: { label: "Queued", className: "bg-muted text-muted-foreground" },
  RUNNING: { label: "Running", className: "bg-accent text-brand-teal" },
  AWAITING_MFA: { label: "Needs sign-in", className: "bg-brand-orange/15 text-brand-orange" },
  SUCCEEDED: { label: "Succeeded", className: "bg-success/10 text-success" },
  PARTIAL: { label: "Partial", className: "bg-brand-orange/15 text-brand-orange" },
  FAILED: { label: "Failed", className: "bg-destructive/10 text-destructive" },
  CANCELLED: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
};

export function SyncStatusBadge({ status }: { status: string | null | undefined }) {
  const s = (status && STYLES[status]) || { label: "Never run", className: "bg-muted text-muted-foreground" };
  return <Badge className={cn("border-0 font-semibold", s.className)}>{s.label}</Badge>;
}
