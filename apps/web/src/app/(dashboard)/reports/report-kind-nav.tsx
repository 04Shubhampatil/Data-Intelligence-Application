"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export function ReportKindNav({ kinds, current }: { kinds: { key: string; label: string }[]; current: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <nav className="flex flex-wrap gap-1.5" aria-label="Report type">
      {kinds.map((k) => {
        const next = new URLSearchParams(params);
        next.set("kind", k.key);
        const active = k.key === current;
        return (
          <Link
            key={k.key}
            href={`${pathname}?${next.toString()}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
              active ? "border-brand-navy bg-brand-navy text-white" : "bg-card text-foreground hover:border-brand-teal hover:bg-accent",
            )}
          >
            {k.label}
          </Link>
        );
      })}
    </nav>
  );
}
