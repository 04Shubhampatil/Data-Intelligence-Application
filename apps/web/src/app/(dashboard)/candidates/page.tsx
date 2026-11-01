import type { Metadata } from "next";
import Link from "next/link";
import { Eye, UsersRound } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { requireUser } from "@/server/auth/session";
import { listCandidates } from "@/server/services/candidate.service";
import { getFilterOptions } from "@/server/services/lookup.service";
import { parseCandidateFilters } from "@/lib/validation/candidates";
import { formatNumber, initials } from "@/lib/format";
import { CandidateFilters } from "./candidate-filters";
import { ReviewStatusBadge } from "@/components/review-status-badge";

export const metadata: Metadata = { title: "Resource Records" };

function Stacked({ top, bottom }: { top?: string | null; bottom?: string | null }) {
  return (
    <div className="leading-snug">
      <p className="font-medium text-foreground">{top || "—"}</p>
      {bottom && <p className="text-xs text-muted-foreground">{bottom}</p>}
    </div>
  );
}

export default async function CandidatesPage({ searchParams }: PageProps<"/candidates">) {
  const user = await requireUser("candidates:read");
  const sp = await searchParams;
  const filters = parseCandidateFilters(sp);
  const [result, options] = await Promise.all([listCandidates(filters, user), getFilterOptions(user)]);

  const hrefFor = (page: number) => {
    const next = new URLSearchParams(
      Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])) as [string, string][],
    );
    next.set("page", String(page));
    return `/candidates?${next.toString()}`;
  };

  return (
    <>
      <PageHeader title="Resource Records" description={`${formatNumber(result.total)} records match the current filters.`} />

      <Card className="mb-6">
        <CardContent>
          <CandidateFilters options={options} />
        </CardContent>
      </Card>

      <Card className="overflow-hidden py-0">
        {result.total === 0 ? (
          <EmptyState
            icon={UsersRound}
            title="No records found"
            description="Either no sync has run yet, or no records match these filters."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="bg-brand-navy text-left text-xs font-semibold uppercase tracking-wide text-white">
                  <th className="w-16 px-4 py-3">Sr. No.</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Department / Project</th>
                  <th className="px-4 py-3">Sub-Project / Designation</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Review</th>
                  <th className="w-20 px-4 py-3 text-center">View</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.rows.map((c, i) => (
                  <tr key={c.id} className="transition-colors hover:bg-accent/50">
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{(result.page - 1) * result.pageSize + i + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar className="size-9">
                          <AvatarFallback className="bg-accent text-xs font-semibold text-brand-navy">{initials(c.fullName)}</AvatarFallback>
                        </Avatar>
                        <Stacked top={c.fullName} bottom={c.sourceEmployeeCode} />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Stacked top={c.departmentHead?.name} bottom={c.employeeType} />
                    </td>
                    <td className="px-4 py-3">
                      <Stacked top={c.subProject?.name} bottom={c.designation?.name} />
                    </td>
                    <td className="px-4 py-3">
                      <Stacked top={c.district?.name} bottom={c.taluka} />
                    </td>
                    <td className="px-4 py-3">
                      <ReviewStatusBadge status={c.reviewStatus} updated={c.reviewUpdated} pendingConfirmation={c.reviewPendingConfirmation} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Button variant="ghost" size="icon-sm" asChild>
                        <Link href={`/candidates/${c.id}`} aria-label={`View ${c.fullName}`}>
                          <Eye />
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t px-4 py-3">
          <Pagination page={result.page} pageCount={result.pageCount} total={result.total} pageSize={result.pageSize} hrefFor={hrefFor} />
        </div>
      </Card>
    </>
  );
}
