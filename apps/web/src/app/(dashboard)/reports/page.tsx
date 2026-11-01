import type { Metadata } from "next";
import { Download, FileBarChart, History, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/empty-state";
import { requireUser } from "@/server/auth/session";
import { getFilterOptions } from "@/server/services/lookup.service";
import { getReport, isReportKind, listRecentReports, REPORT_KIND_KEYS, REPORT_KINDS, type ReportKind } from "@/server/services/report.service";
import { parseCandidateFilters } from "@/lib/validation/candidates";
import { formatDateTime, formatNumber, relativeTime } from "@/lib/format";
import { hasPermission } from "@/lib/rbac";
import { CandidateFilters } from "../candidates/candidate-filters";
import { ReportKindNav } from "./report-kind-nav";

export const metadata: Metadata = { title: "Reports" };

const PRIMARY_KINDS: ReportKind[] = ["district", "project", "department", "designation", "subProject", "employeeType", "gender", "docVerificationStatus"];

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const user = await requireUser("reports:read");
  const sp = await searchParams;
  const kind: ReportKind = isReportKind(sp.kind) ? sp.kind : "district";
  const { page: _p, pageSize: _s, ...filters } = parseCandidateFilters(sp);
  const canExport = hasPermission(user.permissions, "reports:export");

  const [report, options, history] = await Promise.all([getReport(kind, filters, user), getFilterOptions(user), listRecentReports(user)]);

  const exportParams = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && v ? [[k, v]] : [])) as [string, string][]);
  exportParams.set("kind", kind);
  const max = Math.max(...report.groups.map((g) => g.count), 1);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Counts and breakdowns of synced records. Filters apply to every report."
        actions={
          canExport && (
            <Button asChild disabled={report.total === 0}>
              <a href={`/api/reports/export?${exportParams.toString()}`} download>
                <Download /> Export Excel
              </a>
            </Button>
          )
        }
      />

      <div className="mb-4">
        <ReportKindNav kinds={PRIMARY_KINDS.map((k) => ({ key: k, label: REPORT_KINDS[k].label }))} current={kind} />
      </div>

      <Card className="mb-6">
        <CardContent>
          <CandidateFilters options={options} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card className="overflow-hidden py-0">
          <CardHeader className="border-b py-4">
            <CardTitle>{report.label}</CardTitle>
            <CardDescription>
              {formatNumber(report.total)} records across {formatNumber(report.groups.length)} {report.groups.length === 1 ? "group" : "groups"}
            </CardDescription>
          </CardHeader>
          {report.groups.length === 0 ? (
            <EmptyState icon={FileBarChart} title="Nothing to report" description="No synced records match these filters." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="bg-brand-navy text-left text-xs font-semibold uppercase tracking-wide text-white">
                    <th className="w-12 px-4 py-3">#</th>
                    <th className="px-4 py-3">{REPORT_KINDS[kind].label.replace(/-wise.*$/, "")}</th>
                    <th className="w-24 px-4 py-3 text-right">Candidates</th>
                    <th className="w-20 px-4 py-3 text-right">Share</th>
                    <th className="w-48 px-4 py-3"><span className="sr-only">Bar</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {report.groups.map((g, i) => (
                    <tr key={g.label} className="hover:bg-accent/40">
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-2.5 font-medium">{g.label}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(g.count)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{(g.share * 100).toFixed(1)}%</td>
                      <td className="px-4 py-2.5">
                        <div className="h-2 rounded-full bg-muted">
                          <div className="h-2 rounded-full bg-chart-1" style={{ width: `${Math.max(2, (g.count / max) * 100)}%` }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/40 font-semibold">
                    <td className="px-4 py-2.5" />
                    <td className="px-4 py-2.5">Total</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(report.total)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">100%</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card className="gap-0 py-5">
            <CardContent className="flex items-start justify-between gap-4 px-5">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Candidate count</p>
                <p className="mt-2 text-3xl font-bold tabular-nums">{formatNumber(report.total)}</p>
                <p className="mt-1 text-xs text-muted-foreground">under the current filters</p>
              </div>
              <div className="grid size-11 place-items-center rounded-xl bg-accent text-brand-navy">
                <Users className="size-5" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="size-4" /> Your recent exports
              </CardTitle>
              <CardDescription>Each export is audit-logged. Download again to regenerate with current data.</CardDescription>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">No exports yet.</p>
              ) : (
                <ul className="divide-y text-sm" role="list">
                  {history.map((h) => {
                    const again = new URLSearchParams(Object.entries((h.filters ?? {}) as Record<string, string>).filter(([, v]) => !!v));
                    again.set("kind", h.kind);
                    return (
                      <li key={h.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{isReportKind(h.kind) ? REPORT_KINDS[h.kind].label : h.kind}</p>
                          <p className="text-xs text-muted-foreground" title={formatDateTime(h.createdAt)}>
                            {formatNumber(h.rowCount)} rows · {h.groups} groups · {relativeTime(h.createdAt)}
                          </p>
                        </div>
                        {canExport && (
                          <Button size="icon-sm" variant="ghost" asChild aria-label="Download again">
                            <a href={`/api/reports/export?${again.toString()}`} download>
                              <Download />
                            </a>
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
