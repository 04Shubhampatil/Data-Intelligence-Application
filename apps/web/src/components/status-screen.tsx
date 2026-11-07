import type { LucideIcon } from "lucide-react";
import { Brand } from "@/components/layout/brand";
import { cn } from "@/lib/utils";

/**
 * Error / not-found screen. `fullPage` (no sidebar around it) centres it on the screen with the logo;
 * otherwise it fills the main area inside the app shell.
 */
export function StatusScreen({
  icon: Icon,
  tone = "default",
  code,
  title,
  description,
  actions,
  reference,
  fullPage = false,
}: {
  icon: LucideIcon;
  tone?: "default" | "danger";
  code?: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
  /** Error digest — matches the line in the server log, so an admin can find what happened. */
  reference?: string;
  fullPage?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 text-center",
        fullPage ? "min-h-screen bg-background py-16" : "min-h-[60vh] py-12",
      )}
    >
      {fullPage && (
        <div className="mb-10">
          <Brand />
        </div>
      )}
      <div className="relative mb-6">
        <div
          className={cn(
            "absolute inset-0 -z-10 scale-150 rounded-full blur-2xl",
            tone === "danger" ? "bg-destructive/15" : "bg-brand-teal/15",
          )}
        />
        <div
          className={cn(
            "grid size-16 place-items-center rounded-2xl border shadow-sm",
            tone === "danger" ? "border-destructive/20 bg-destructive/10 text-destructive" : "border-border bg-card text-brand-teal",
          )}
        >
          <Icon className="size-8" strokeWidth={1.75} />
        </div>
      </div>
      {code && <p className="mb-1 font-mono text-xs font-semibold tracking-[0.2em] text-muted-foreground">{code}</p>}
      <h1 className="text-2xl font-bold tracking-tight text-brand-navy sm:text-3xl">{title}</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
      {actions && <div className="mt-7 flex flex-wrap items-center justify-center gap-3">{actions}</div>}
      {reference && (
        <p className="mt-8 rounded-md bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
          Reference: {reference}
        </p>
      )}
    </div>
  );
}
