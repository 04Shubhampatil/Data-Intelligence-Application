"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FilterOptions, Option } from "@/server/services/lookup.service";

const FILTER_KEYS = ["districtId", "departmentHeadId", "departmentId", "subProjectId", "designationId", "employeeType", "gender", "educationType", "reviewStatus"] as const;
const REVIEW_OPTIONS: Option[] = [
  { value: "PENDING_REVIEW", label: "Pending review" },
  { value: "SELECTED", label: "Verified" },
  { value: "REJECTED", label: "Rejected" },
  { value: "AWAITING_CONFIRMATION", label: "Awaiting confirmation" },
];

function FilterSelect({
  label,
  name,
  options,
  value,
  onChange,
}: {
  label: string;
  name: string;
  options: Option[];
  value: string;
  onChange: (name: string, value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`f-${name}`} className="text-xs font-semibold text-muted-foreground">
        {label}
      </Label>
      <Select value={value || "all"} onValueChange={(v) => onChange(name, v)}>
        <SelectTrigger id={`f-${name}`} className="h-9 w-full bg-card">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function CandidateFilters({ options }: { options: FilterOptions }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const urlQ = params.get("q") ?? "";
  const [q, setQ] = useState(urlQ);
  const [lastUrlQ, setLastUrlQ] = useState(urlQ);
  if (urlQ !== lastUrlQ) {
    // The URL changed (back/forward, reset): show its search text.
    setLastUrlQ(urlQ);
    setQ(urlQ);
  }

  function push(next: URLSearchParams) {
    next.delete("page");
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  function setFilter(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (!value || value === "all") next.delete(name);
    else next.set(name, value);
    // Cascade like the source dashboard: sub-project depends on department/project.
    if (name === "departmentHeadId") next.delete("subProjectId");
    push(next);
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams(params);
    if (q.trim()) next.set("q", q.trim());
    else next.delete("q");
    push(next);
  }

  const dept = params.get("departmentHeadId") ?? "";
  const subProjects = dept ? options.subProjects.filter((s) => s.parent === dept) : options.subProjects;
  const active = FILTER_KEYS.some((k) => params.get(k)) || !!params.get("q");

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FilterSelect label="District" name="districtId" options={options.districts} value={params.get("districtId") ?? ""} onChange={setFilter} />
        <FilterSelect label="Department / Project" name="departmentHeadId" options={options.departmentHeads} value={dept} onChange={setFilter} />
        <FilterSelect label="Department" name="departmentId" options={options.departments} value={params.get("departmentId") ?? ""} onChange={setFilter} />
        <FilterSelect label="Sub-Project" name="subProjectId" options={subProjects} value={params.get("subProjectId") ?? ""} onChange={setFilter} />
        <FilterSelect label="Designation" name="designationId" options={options.designations} value={params.get("designationId") ?? ""} onChange={setFilter} />
        <FilterSelect label="Type of Employee" name="employeeType" options={options.employeeTypes} value={params.get("employeeType") ?? ""} onChange={setFilter} />
        <FilterSelect label="Gender" name="gender" options={options.genders} value={params.get("gender") ?? ""} onChange={setFilter} />
        <FilterSelect label="Education Type" name="educationType" options={options.educationTypes} value={params.get("educationType") ?? ""} onChange={setFilter} />
        <FilterSelect label="Review status" name="reviewStatus" options={REVIEW_OPTIONS} value={params.get("reviewStatus") ?? ""} onChange={setFilter} />
        <div className="flex items-end">
          <Button
            variant="outline"
            className="h-9 w-full"
            disabled={!active || pending}
            onClick={() => startTransition(() => router.push(pathname, { scroll: false }))}
          >
            <RotateCcw /> Reset filters
          </Button>
        </div>
      </div>

      <form onSubmit={submitSearch} className="flex gap-2" role="search">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or employee code"
            aria-label="Search records"
            maxLength={80}
            className="h-9 bg-card pl-9"
          />
        </div>
        <Button type="submit" className="h-9" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Search />} Search
        </Button>
      </form>
    </div>
  );
}
