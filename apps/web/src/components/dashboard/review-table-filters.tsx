"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STATUS = [
  { value: "PENDING_REVIEW", label: "Pending" },
  { value: "SELECTED", label: "Selected" },
  { value: "REJECTED", label: "Rejected" },
];

/** District + status filters for the dashboard's Candidate Review table (kept in the URL). */
export function ReviewTableFilters({ districts }: { districts: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete(key);
    else next.set(key, value);
    start(() => router.push(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" />}
      {districts.length > 1 && (
        <Select value={params.get("district") ?? "all"} onValueChange={(v) => set("district", v)}>
          <SelectTrigger className="h-9 w-40 rounded-xl bg-card text-xs" aria-label="District"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Districts</SelectItem>
            {districts.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      <Select value={params.get("status") ?? "all"} onValueChange={(v) => set("status", v)}>
        <SelectTrigger className="h-9 w-32 rounded-xl bg-card text-xs" aria-label="Status"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          {STATUS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
