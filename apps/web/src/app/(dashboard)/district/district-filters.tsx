"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Option = { value: string; label: string };
type Props = { districts: Option[]; departmentHeads: Option[]; departments: Option[]; designations: Option[]; reviewers: Option[] };

const STATUS: Option[] = [
  { value: "PENDING_REVIEW", label: "Pending review" },
  { value: "SELECTED", label: "Verified" },
  { value: "REJECTED", label: "Rejected" },
  { value: "AWAITING_CONFIRMATION", label: "Awaiting confirmation" },
];

function Sel({ label, name, options, value, onChange }: { label: string; name: string; options: Option[]; value: string; onChange: (n: string, v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`df-${name}`} className="text-xs font-semibold text-muted-foreground">{label}</Label>
      <Select value={value || "all"} onValueChange={(v) => onChange(name, v)}>
        <SelectTrigger id={`df-${name}`} className="h-9 w-full bg-card"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export function DistrictFilters(p: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  const push = (next: URLSearchParams) => {
    next.delete("page");
    start(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  const set = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (!value || value === "all") next.delete(name);
    else next.set(name, value);
    push(next);
  };
  const active = [...params.keys()].some((k) => k !== "page");

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {p.districts.length > 1 && <Sel label="District" name="districtId" options={p.districts} value={params.get("districtId") ?? ""} onChange={set} />}
        <Sel label="Department / Project" name="departmentHeadId" options={p.departmentHeads} value={params.get("departmentHeadId") ?? ""} onChange={set} />
        <Sel label="Department" name="departmentId" options={p.departments} value={params.get("departmentId") ?? ""} onChange={set} />
        <Sel label="Designation" name="designationId" options={p.designations} value={params.get("designationId") ?? ""} onChange={set} />
        <Sel label="Review status" name="reviewStatus" options={STATUS} value={params.get("reviewStatus") ?? ""} onChange={set} />
        <Sel label="Reviewed by" name="reviewerId" options={p.reviewers} value={params.get("reviewerId") ?? ""} onChange={set} />
        <div className="space-y-1.5">
          <Label htmlFor="df-from" className="text-xs font-semibold text-muted-foreground">Reviewed from</Label>
          <Input id="df-from" type="date" value={params.get("from") ?? ""} onChange={(e) => set("from", e.target.value)} className="h-9 bg-card" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="df-to" className="text-xs font-semibold text-muted-foreground">Reviewed to</Label>
          <Input id="df-to" type="date" value={params.get("to") ?? ""} onChange={(e) => set("to", e.target.value)} className="h-9 bg-card" />
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          set("q", q.trim());
        }}
        className="flex gap-2"
        role="search"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or employee code" maxLength={80} className="h-9 bg-card pl-9" aria-label="Search" />
        </div>
        <Button type="submit" className="h-9" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Search />} Search</Button>
        <Button type="button" variant="outline" className="h-9" disabled={!active || pending} onClick={() => start(() => router.push(pathname, { scroll: false }))}>
          <RotateCcw /> Reset
        </Button>
      </form>
    </div>
  );
}
