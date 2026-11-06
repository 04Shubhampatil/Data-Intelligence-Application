import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BadgeCheck, Eye, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/pagination";
import { EmptyState } from "@/components/empty-state";
import { CandidateAvatar } from "@/components/candidate-avatar";
import { requireUser } from "@/server/auth/session";
import { getVerifiedRecords } from "@/server/services/district.service";
import { prisma } from "@di/db";
import { formatDateTime, formatNumber } from "@/lib/format";
import { canOpenDashboard, homeFor } from "@/lib/rbac";

export const metadata: Metadata = { title: "Verified records" };

/**
 * District Admin only: candidates verified in the admin's own districts.
 * The query is scoped by the signed-in user's district assignments, so other districts never appear.
 */
export default async function VerifiedRecordsPage({ searchParams }: PageProps<"/verified-records">) {
  const user = await requireUser("reviews:read");
  if (!canOpenDashboard("verified", user.role)) redirect(homeFor(user.role));

  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const [verified, districts] = await Promise.all([
    getVerifiedRecords(user, { page: Number(one("page")) || 1, q: one("q") }),
    user.districtScopeIds.length ? prisma.district.findMany({ where: { id: { in: user.districtScopeIds } }, orderBy: { name: "asc" }, select: { name: true } }) : [],
  ]);

  return (
    <>
      <PageHeader title="Verified Records" description={districts.length ? `Verified users in ${districts.map((d) => d.name).join(", ")}` : "No district is assigned to your account yet — ask the Super Admin to assign one."} />

    <Card className="overflow-hidden py-0">
      <CardHeader className="flex flex-col gap-3 border-b py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><BadgeCheck className="size-5 text-success" /> Verified users</CardTitle>
          <CardDescription>
            {formatNumber(verified.total)} verified user{verified.total === 1 ? "" : "s"}{verified.q ? ` matching \u201c${verified.q}\u201d` : ""} {districts.length ? `in ${districts.map((d) => d.name).join(", ")}` : "across all districts"}. Only users verified in your district are listed.
          </CardDescription>
        </div>
        <form action="/verified-records" className="flex w-full gap-2 sm:w-auto" role="search">
          <Input name="q" defaultValue={verified.q} placeholder="Name or Employee ID" aria-label="Search verified users" className="h-9 sm:w-60" />
          <Button type="submit" variant="outline" size="sm" className="h-9"><Search /> Search</Button>
        </form>
      </CardHeader>
      {verified.rows.length === 0 ? (
        <EmptyState icon={BadgeCheck} title={verified.q ? "No matches" : "No verified users yet"} description={verified.q ? "No verified user in your district matches this search." : "Users from your district appear here once they are verified."} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b bg-muted/70 text-left text-xs font-semibold text-foreground">
                <th className="px-4 py-3">Candidate</th>
                <th className="px-4 py-3">Employee ID</th>
                <th className="px-4 py-3">Designation</th>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Verified by</th>
                <th className="px-4 py-3">Verified on</th>
                <th className="w-16 px-4 py-3 text-center">View</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {verified.rows.map((r) => (
                <tr key={r.id} className="hover:bg-accent/40">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <CandidateAvatar photoUrl={r.photoUrl} name={r.fullName} size="sm" />
                      <div className="min-w-0">
                        <p className="font-medium">{r.fullName}</p>
                        <p className="text-xs text-muted-foreground">{r.sourceEmployeeCode}{" \u00b7 "}{r.district?.name ?? "\u2014"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">{r.officialEmployeeId ?? "\u2014"}</td>
                  <td className="px-4 py-2.5 text-xs">{r.designation?.name ?? "\u2014"}</td>
                  <td className="px-4 py-2.5 text-xs">{r.departmentHead?.name ?? "\u2014"}</td>
                  <td className="px-4 py-2.5 text-xs">{r.verifiedBy ?? "\u2014"}</td>
                  <td className="px-4 py-2.5 text-xs">{r.verifiedAt ? formatDateTime(r.verifiedAt) : "\u2014"}</td>
                  <td className="px-4 py-2.5 text-center">
                    <Button variant="ghost" size="icon-sm" asChild><Link href={`/candidates/${r.id}`} aria-label={`View ${r.fullName}`}><Eye /></Link></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t px-4 py-3">
        <Pagination page={verified.page} pageCount={verified.pageCount} total={verified.total} pageSize={verified.pageSize} hrefFor={(page) => `/verified-records?${new URLSearchParams({ ...(verified.q ? { q: verified.q } : {}), page: String(page) })}`} />
      </div>
    </Card>
    </>
  );
}
