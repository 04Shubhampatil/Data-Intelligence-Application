import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

/** Page numbers with ellipses, e.g. 1 2 3 4 5 … 513 — same shape as the source table. */
export function pageWindow(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current - 1, current, current + 1]);
  if (current <= 4) [2, 3, 4, 5].forEach((p) => pages.add(p));
  if (current >= total - 3) [total - 4, total - 3, total - 2, total - 1].forEach((p) => pages.add(p));
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  sorted.forEach((p, i) => {
    if (i && p - sorted[i - 1] > 1) out.push("…");
    out.push(p);
  });
  return out;
}

export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  hrefFor: (page: number) => string;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const linkCls = "grid h-8 min-w-8 place-items-center rounded-lg px-2 text-sm font-medium transition-colors";

  return (
    <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-sm text-muted-foreground">
        Showing {formatNumber(from)} to {formatNumber(to)} of {formatNumber(total)} entries
      </p>
      {pageCount > 1 && (
        <nav className="flex items-center gap-1" aria-label="Pagination">
          <Link
            href={hrefFor(page - 1)}
            aria-disabled={page <= 1}
            className={cn(linkCls, "hover:bg-muted", page <= 1 && "pointer-events-none opacity-40")}
          >
            <ChevronLeft className="size-4" />
            <span className="sr-only">Previous</span>
          </Link>
          {pageWindow(page, pageCount).map((p, i) =>
            p === "…" ? (
              <span key={`e${i}`} className="px-1 text-muted-foreground">
                …
              </span>
            ) : (
              <Link
                key={p}
                href={hrefFor(p)}
                aria-current={p === page ? "page" : undefined}
                className={cn(linkCls, p === page ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
              >
                {p}
              </Link>
            ),
          )}
          <Link
            href={hrefFor(page + 1)}
            aria-disabled={page >= pageCount}
            className={cn(linkCls, "hover:bg-muted", page >= pageCount && "pointer-events-none opacity-40")}
          >
            <ChevronRight className="size-4" />
            <span className="sr-only">Next</span>
          </Link>
        </nav>
      )}
    </div>
  );
}
