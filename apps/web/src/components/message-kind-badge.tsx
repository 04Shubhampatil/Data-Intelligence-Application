import { cn } from "@/lib/utils";

const STYLES: Record<string, { label: string; className: string }> = {
  MESSAGE: { label: "Message", className: "bg-accent text-brand-navy" },
  ANNOUNCEMENT: { label: "Announcement", className: "bg-brand-orange/15 text-brand-orange" },
  REMINDER: { label: "Reminder", className: "bg-warning/15 text-brand-orange" },
};

export function MessageKindBadge({ kind, className }: { kind: string; className?: string }) {
  const s = STYLES[kind] ?? STYLES.MESSAGE;
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", s.className, className)}>{s.label}</span>;
}
