"use client";

import { useEffect, useRef } from "react";
import { Search } from "lucide-react";

/** Header search: submits to Resource Records (name, profile code or printed Employee ID). ⌘K / Ctrl+K focuses it. */
export function GlobalSearch() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form action="/candidates" method="get" role="search" className="relative hidden w-full max-w-md md:block">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={ref}
        name="q"
        type="search"
        maxLength={80}
        placeholder="Search candidates, employee IDs…"
        aria-label="Search candidates"
        className="h-10 w-full rounded-xl border border-border/80 bg-muted/60 pl-10 pr-14 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary/40 focus:bg-card focus:ring-3 focus:ring-ring/40"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border bg-card px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted-foreground">⌘ K</kbd>
    </form>
  );
}
