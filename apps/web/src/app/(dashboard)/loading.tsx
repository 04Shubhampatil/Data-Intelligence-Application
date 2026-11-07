import { Skeleton } from "@/components/ui/skeleton";

/** Shown at once while a page loads; the sidebar and header stay in place. */
export default function DashboardLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading…</span>
      <div className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-brand-teal/15">
        <div className="h-full w-1/3 animate-[loading-bar_1.1s_ease-in-out_infinite] rounded-full bg-brand-teal" />
      </div>

      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-start justify-between rounded-2xl border bg-card p-5">
            <div className="space-y-3">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-7 w-16" />
            </div>
            <Skeleton className="size-10 rounded-xl" />
          </div>
        ))}
      </div>

      <div className="rounded-2xl border bg-card">
        <div className="space-y-2 border-b p-5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3.5 w-64 max-w-full" />
        </div>
        <div className="divide-y">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3.5">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="hidden h-6 w-20 rounded-full sm:block" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
