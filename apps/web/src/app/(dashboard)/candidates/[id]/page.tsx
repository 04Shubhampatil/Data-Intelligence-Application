import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Briefcase, Building2, CalendarDays, ChevronRight, FileText, GraduationCap, History, Home, LifeBuoy, MapPin, RefreshCw, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/server/auth/session";
import { getCandidate } from "@/server/services/candidate.service";
import { recordAccessDeniedIfExists } from "@/server/auth/scope";
import { listCandidateDocuments } from "@/server/services/document.service";
import { DocumentsGrid } from "@/components/documents/documents-grid";
import { ReviewPanel } from "./review-panel";
import { isDecisionRole } from "@di/db/permissions";
import { ReviewTimeline } from "./review-timeline";
import { PersonalDetailsCard } from "./personal-details";
import { getPersonalDetails } from "@/server/services/personal.service";
import { getAttendance, getSensitiveGroups, getTickets } from "@/server/services/sensitive.service";
import { AttendanceCard, OfficeLocation, SensitiveSections, TicketsCard } from "./profile-sections";
import { ContactCard } from "./contact-card";
import {
  AttendanceSummary, CardTitleIcon, DocumentsStrip, KpiTiles, KV, ProfileSidebar, RecentActivity, StatusPill, TabBar, TABS,
  sourceStatusTone, type ActivityItem, type TabKey,
} from "./profile-view";
import { audit } from "@/server/security/audit";
import { isSensitiveGroup } from "@di/core";
import { getReviewTimeline } from "@/server/services/review.service";
import { DOCUMENT_DEFS, type DocumentKind } from "@di/core";
import { prisma } from "@di/db";
import { formatDate, formatDateTime, roleLabel } from "@/lib/format";
import { experienceMonths, formatExperience, highestQualification } from "@/lib/experience";
import { hasPermission } from "@/lib/rbac";
import { decisionLabel } from "@/lib/review-labels";

export const metadata: Metadata = { title: "Candidate profile" };

export default async function CandidateDetailPage({ params, searchParams }: PageProps<"/candidates/[id]">) {
  const user = await requireUser("candidates:read");
  const { id } = await params;
  if (!/^[a-z0-9]{1,40}$/i.test(id)) notFound();
  const c = await getCandidate(id, user);
  if (!c) {
    await recordAccessDeniedIfExists(user, id, "candidate_detail");
    notFound();
  }
  const sp = await searchParams;
  const canSeeContact = hasPermission(user.permissions, "candidates:read_contact");
  const canSeeDocuments = hasPermission(user.permissions, "documents:read");
  const canSeePersonal = hasPermission(user.permissions, "candidates:read_personal");
  const canSeeReviews = hasPermission(user.permissions, "reviews:read");
  const personal = canSeePersonal ? await getPersonalDetails(c.id, user) : null;
  const pd = personal?.state === "ok" ? personal.details : null;

  // Masked-identifier reveal (audited) and the active tab both live in the URL.
  const revealList = typeof sp.reveal === "string" ? sp.reveal.split(",") : [];
  const reveal = revealList.filter(isSensitiveGroup);
  const revealContact = canSeeContact && revealList.includes("contact");
  if (revealContact && !reveal.includes("contactExtra")) reveal.push("contactExtra");
  const requestedTab = TABS.find((t) => t.key === sp.tab)?.key ?? "overview";
  const href = (o: { tab?: TabKey; reveal?: string[] }) => {
    const q = new URLSearchParams();
    const tab = o.tab ?? requestedTab;
    if (tab !== "overview") q.set("tab", tab);
    const r = [...new Set(o.reveal ?? revealList)];
    if (r.length) q.set("reveal", r.join(","));
    return `/candidates/${c.id}${q.size ? `?${q}` : ""}`;
  };

  const [sensitiveGroups, attendance, tickets, office, documents, policies, timeline] = await Promise.all([
    getSensitiveGroups(c.id, user, new Set(reveal)),
    getAttendance(c.id, user),
    getTickets(c.id, user),
    prisma.candidateProfile.findUnique({ where: { candidateId: c.id }, select: { officeLat: true, officeLng: true } }),
    canSeeDocuments ? listCandidateDocuments(c.id, user) : Promise.resolve([]),
    prisma.documentPolicy.findMany({ where: { sourceConnectionId: c.sourceConnectionId, allowed: false }, select: { kind: true } }),
    getReviewTimeline(c.id, user),
  ]);
  const contactGroup = sensitiveGroups.find((g) => g.group === "contactExtra");
  const contactExtra = contactGroup?.state === "ok" ? contactGroup.data : null;
  // One audit entry per reveal: getSensitiveGroups already logged it when the WhatsApp/personal-email group was decrypted.
  if (revealContact && contactGroup?.state !== "ok") await audit("SENSITIVE_REVEAL", { userId: user.id, target: c.id, metadata: { groups: ["contact"] } });
  const categoryGroup = sensitiveGroups.find((g) => g.group === "category");
  const category = categoryGroup?.state === "ok" ? (categoryGroup.data as { religion?: string; caste?: string; category?: string }) : null;

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const canDecideRole = isDecisionRole(user.role); // Super Admin, or District Admin (page is already district-scoped)
  const latestReview = timeline.reviews[0] ?? null; // newest first
  const pendingReview = timeline.reviews.find((r) => r.requiresConfirmation && !r.confirmedAt) ?? null;
  const photo = documents.find((d) => d.kind === "PROFILE_PHOTO" && d.previewUrl);
  const files = documents.filter((d) => d.kind !== "PROFILE_PHOTO");
  const notApproved = policies.map((p) => DOCUMENT_DEFS[p.kind as DocumentKind]?.label ?? p.kind);
  const employeeId = c.officialEmployeeId ?? c.sourceEmployeeCode;

  const hidden: TabKey[] = [
    ...(!canSeeDocuments ? (["documents"] as const) : []),
    ...(attendance === null ? (["attendance"] as const) : []),
    ...(tickets === null ? (["tickets"] as const) : []),
    ...(!canSeeReviews ? (["comments"] as const) : []),
  ];
  const tab: TabKey = hidden.includes(requestedTab) ? "overview" : requestedTab;

  // KPI tiles
  const exp = experienceMonths(c.joiningDate, pd?.employment ?? []);
  const topEducation = highestQualification(pd?.education ?? []);
  const eduDocs = files.filter((d) => d.category === "education");
  const eduVerified = eduDocs.length > 0 && eduDocs.every((d) => d.sourceVerification === "Verified");
  const tiles = [
    { icon: Briefcase, tint: "bg-blue-100 text-blue-700", label: "Total Experience", value: c.joiningDate || pd ? formatExperience(exp.months) : "—", note: c.joiningDate ? `Joined ${formatDate(c.joiningDate)}` : "Joining date not available" },
    { icon: GraduationCap, tint: "bg-emerald-100 text-emerald-700", label: "Education", value: topEducation?.qualification ?? c.educationType ?? "—", note: eduDocs.length ? (eduVerified ? "Verified" : "Verification pending") : "No certificate", good: eduVerified },
    { icon: Building2, tint: "bg-violet-100 text-violet-700", label: "Department", value: c.department?.name ?? c.departmentHead?.name ?? "—", note: c.sourceStatus ?? "Status unknown", good: sourceStatusTone(c.sourceStatus) === "success" },
    { icon: MapPin, tint: "bg-orange-100 text-orange-700", label: "District", value: c.district?.name ?? "—", note: c.taluka ? `Taluka ${c.taluka}` : c.district ? "Assigned" : "Not assigned", good: !!c.district },
  ];

  // Activity: sync milestones + decisions + comments (decisions/comments only for reviewers)
  const activity: ActivityItem[] = [
    ...(c.profileSyncedAt ? [{ at: c.profileSyncedAt, text: "Profile synced from MAHAHRD", tone: "primary" as const }] : []),
    ...(c.documentsSyncedAt ? [{ at: c.documentsSyncedAt, text: "Documents synced", tone: "primary" as const }] : []),
    ...(tickets ?? []).map((t) => ({ at: t.syncedAt, text: `Ticket ${t.ticketNumber ?? ""} · ${t.subject ?? ""}`.trim(), tone: "muted" as const })),
    ...timeline.reviews.map((r) => ({ at: r.createdAt, text: `${decisionLabel(r.decision)} by ${r.reviewedBy.name ?? r.reviewedBy.email}`, tone: r.decision === "SELECTED" ? ("success" as const) : ("danger" as const) })),
    ...timeline.comments.map((m) => ({ at: m.createdAt, text: `Comment by ${m.author.name ?? m.author.email}`, tone: "muted" as const })),
    { at: c.createdAt, text: "Record first synced", tone: "muted" as const },
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const latestMonth = attendance?.[0] ?? null;
  const quick = [
    canSeeDocuments && { href: href({ tab: "documents" }), label: "View Documents", icon: FileText },
    { href: href({ tab: "activity" }), label: "View History", icon: History },
    tickets && { href: href({ tab: "tickets" }), label: "View Tickets", icon: LifeBuoy },
    attendance && { href: href({ tab: "attendance" }), label: "View Attendance", icon: CalendarDays },
  ].filter(Boolean) as { href: string; label: string; icon: typeof FileText }[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" size="sm" asChild className="rounded-xl bg-card">
          <Link href="/candidates"><ArrowLeft /> Back to Candidates</Link>
        </Button>
        <p className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-success" aria-hidden />Last synced: {formatDateTime(c.profileSyncedAt ?? c.lastSyncedAt)}</span>
          {hasPermission(user.permissions, "sync:read") && (
            <Link href="/sync" className="inline-flex items-center gap-1 rounded-xl bg-accent px-3 py-1.5 font-semibold text-accent-foreground hover:bg-accent/70"><RefreshCw className="size-3.5" /> Sync Details</Link>
          )}
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[19rem_1fr]">
        <ProfileSidebar
          name={c.fullName}
          employeeId={employeeId}
          sourceStatus={c.sourceStatus}
          photoUrl={photo?.previewUrl ?? null}
          district={c.district?.name ?? null}
          lines={[
            { icon: Briefcase, text: c.designation?.name },
            { icon: Building2, text: c.department?.name },
            { icon: UserRound, text: c.subProject?.name },
            { icon: CalendarDays, text: c.joiningDate ? `Joined: ${formatDate(c.joiningDate)}` : null },
          ]}
          review={
            canSeeReviews
              ? {
                  status: c.reviewStatus,
                  updated: c.reviewUpdated,
                  pendingConfirmation: c.reviewPendingConfirmation,
                  latest: latestReview ? { label: decisionLabel(latestReview.decision), by: latestReview.reviewedBy.name ?? latestReview.reviewedBy.email, at: formatDateTime(latestReview.createdAt) } : null,
                }
              : null
          }
          quick={quick}
        />

        <div className="min-w-0 space-y-6">
          {/* Banner */}
          <section className="relative overflow-hidden rounded-3xl bg-linear-to-r from-[#0b1f4d] via-[#123a8c] to-[#1d4ed8] px-6 py-6 text-white shadow-card sm:px-8">
            <div className="pointer-events-none absolute -right-16 -top-20 size-72 rounded-full bg-sky-400/20 blur-3xl" aria-hidden />
            <div className="relative flex flex-wrap items-end justify-between gap-5">
              <div className="min-w-0">
                <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-white/75">
                  <Home className="size-3.5" /><ChevronRight className="size-3" />
                  <Link href="/candidates" className="hover:text-white">Candidates</Link><ChevronRight className="size-3" />
                  <span>Candidate Details</span>
                </nav>
                <h2 className="mt-2 flex flex-wrap items-center gap-3 text-2xl font-bold tracking-tight sm:text-3xl">
                  {c.fullName}
                  {c.sourceStatus && <StatusPill tone={sourceStatusTone(c.sourceStatus)}>{c.sourceStatus}</StatusPill>}
                </h2>
                <p className="mt-1.5 text-sm text-white/85">{[employeeId, c.designation?.name, c.district ? `${c.district.name} District` : null].filter(Boolean).join("  •  ")}</p>
              </div>
              {canSeeReviews && (
                <ReviewPanel
                  variant="banner"
                  candidateId={c.id}
                  candidateName={c.fullName}
                  status={c.reviewStatus}
                  updated={c.reviewUpdated}
                  pendingConfirmation={c.reviewPendingConfirmation}
                  pendingReviewId={pendingReview?.id ?? null}
                  can={{
                    // Super Admin / District Admin — the role and district are checked again on the server for every action.
                    decide: canDecideRole && hasPermission(user.permissions, "reviews:decide"),
                    override: canDecideRole && hasPermission(user.permissions, "reviews:override") && (isSuperAdmin || latestReview?.reviewedBy.role.name !== "SUPER_ADMIN"),
                    confirm: isSuperAdmin && hasPermission(user.permissions, "reviews:confirm"),
                    comment: isSuperAdmin && hasPermission(user.permissions, "comments:write"),
                  }}
                  latest={latestReview ? { decision: latestReview.decision, by: latestReview.reviewedBy.name ?? latestReview.reviewedBy.email, byRole: roleLabel(latestReview.reviewedBy.role.name), at: formatDateTime(latestReview.createdAt), remark: latestReview.remark || null } : null}
                />
              )}
            </div>
          </section>

          <KpiTiles tiles={tiles} />

          <TabBar
            active={tab}
            hidden={hidden}
            hrefFor={(t) => href({ tab: t })}
            counts={{ documents: files.filter((d) => d.status === "STORED").length, tickets: tickets?.length ?? 0, comments: timeline.comments.length }}
          />

          {tab === "overview" && (
            <>
              <div className="grid gap-6 xl:grid-cols-2">
                <Card>
                  <CardTitleIcon icon={UserRound} title="Personal Details" />
                  <CardContent className="flex flex-col gap-5 sm:flex-row">
                    <div className="min-w-0 flex-1">
                      <KV
                        narrow
                        rows={[
                          ["Full Name", c.fullName],
                          ["Gender", c.gender],
                          ...(canSeePersonal ? ([["Date of Birth", pd?.dateOfBirth], ["Marital Status", pd?.maritalStatus], ["Blood Group", pd?.bloodGroup]] as [string, React.ReactNode][]) : []),
                          ...(category ? ([["Religion", category.religion], ["Caste", category.caste ?? category.category]] as [string, React.ReactNode][]) : []),
                        ]}
                      />
                      {!canSeePersonal && <p className="mt-3 text-xs text-muted-foreground">Further personal details are restricted for your role.</p>}
                    </div>
                    {photo && (
                      <div className="shrink-0 text-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo.previewUrl} alt="" className="mx-auto h-28 w-22 rounded-xl object-cover ring-1 ring-border" />
                        <p className="mt-1.5 text-xs font-medium text-muted-foreground">Profile Photo</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <ContactCard
                  d={{
                    officialEmployeeId: c.officialEmployeeId,
                    profileCode: c.sourceEmployeeCode,
                    joiningDate: c.joiningDate,
                    contact: canSeeContact
                      ? { mobile: c.profile?.mobile ?? null, officialEmail: c.profile?.officialEmail ?? null, whatsapp: (contactExtra?.whatsapp as string | undefined) ?? null, personalEmail: (contactExtra?.personalEmail as string | undefined) ?? null }
                      : null,
                    canSeeOfficer: canSeePersonal,
                    officer: pd?.reportingOfficer ?? null,
                    revealed: revealContact,
                  }}
                  revealHref={href({ reveal: [...revealList.filter((r) => r !== "contact"), "contact"] })}
                  hideHref={href({ reveal: revealList.filter((r) => r !== "contact" && r !== "contactExtra") })}
                />

                <Card>
                  <CardTitleIcon icon={Briefcase} title="Employment Details" action={c.sourceStatus ? <StatusPill tone={sourceStatusTone(c.sourceStatus)}>{c.sourceStatus}</StatusPill> : undefined} />
                  <CardContent>
                    <KV
                      rows={[
                        ["Department", c.department?.name],
                        ["Project", c.departmentHead?.name],
                        ["Sub-Project", c.subProject?.name],
                        ["Designation", c.designation?.name],
                        ["Employee Type", c.employeeType],
                        ["Joining Date", c.joiningDate ? formatDate(c.joiningDate) : null],
                        ...(canSeePersonal ? ([["Reporting Officer", pd?.reportingOfficer?.name]] as [string, React.ReactNode][]) : []),
                      ]}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardTitleIcon icon={GraduationCap} title="Education Details" />
                  <CardContent className="flex flex-col gap-5 sm:flex-row">
                    <div className="min-w-0 flex-1">
                      {pd?.education.length ? (
                        <KV rows={[["Qualification", topEducation?.qualification], ["University / Board", topEducation?.board], ["Passing Year", topEducation?.yearOfPassing], ["Marks / %", topEducation?.marks]]} />
                      ) : (
                        <KV rows={[["Education type", c.educationType], ["Document verification", c.docVerificationStatus]]} />
                      )}
                      {pd && pd.education.length > 1 && <p className="mt-3 text-xs text-muted-foreground">{pd.education.length - 1} more qualification{pd.education.length > 2 ? "s" : ""} below in Full profile.</p>}
                    </div>
                    {eduDocs[0]?.previewUrl && eduDocs[0].mimeType?.startsWith("image/") && (
                      <a href={eduDocs[0].previewUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={eduDocs[0].previewUrl} alt="" className="mx-auto h-28 w-24 rounded-lg object-cover ring-1 ring-border" />
                        <span className="mt-1.5 block text-xs font-medium text-muted-foreground">{eduDocs[0].label}</span>
                        <span className="text-xs font-semibold text-primary">View</span>
                      </a>
                    )}
                  </CardContent>
                </Card>
              </div>

              {canSeeDocuments && <DocumentsStrip docs={files} href={href({ tab: "documents" })} />}

              <div className="grid gap-6 xl:grid-cols-2">
                {attendance && <AttendanceSummary month={latestMonth} href={href({ tab: "attendance" })} />}
                <RecentActivity items={activity.slice(0, 4)} href={href({ tab: "activity" })} />
              </div>

              {personal && (
                <details className="group rounded-2xl" open={revealList.length > 0}>
                  <summary className="cursor-pointer list-none rounded-2xl border bg-card px-5 py-3.5 text-sm font-semibold text-foreground shadow-card marker:hidden">
                    Full profile <span className="font-normal text-muted-foreground">— education rows, previous employment, domicile, nominee{sensitiveGroups.some((g) => g.state !== "forbidden" && g.group !== "contactExtra") ? ", sensitive details" : ""}</span>
                  </summary>
                  <div className="mt-4 space-y-6">
                    <PersonalDetailsCard view={personal} />
                    <SensitiveSections groups={sensitiveGroups.filter((g) => g.group !== "contactExtra")} candidateId={c.id} revealed={reveal} />
                  </div>
                </details>
              )}
              {!personal && <SensitiveSections groups={sensitiveGroups.filter((g) => g.group !== "contactExtra")} candidateId={c.id} revealed={reveal} />}

              {office?.officeLat != null && office.officeLng != null && <OfficeLocation lat={office.officeLat} lng={office.officeLng} />}
            </>
          )}

          {tab === "documents" && <DocumentsGrid documents={files} notApproved={notApproved} />}
          {tab === "attendance" && attendance && <AttendanceCard months={attendance} />}
          {tab === "tickets" && tickets && <TicketsCard tickets={tickets} />}
          {tab === "activity" && <RecentActivity items={activity} href={href({ tab: "overview" })} />}
          {tab === "comments" && <ReviewTimeline reviews={timeline.reviews} comments={timeline.comments} />}

          <Card className="gap-0 bg-transparent py-0 shadow-none ring-0">
            <CardContent className="px-1 text-xs text-muted-foreground">
              Source: {c.sourceConnection.name}. Sensitive groups are collected only where approved and stored encrypted; the full Aadhaar number and employee portal credentials are never read.
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
