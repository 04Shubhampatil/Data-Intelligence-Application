import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/server/auth/session";
import { getCandidate } from "@/server/services/candidate.service";
import { recordAccessDeniedIfExists } from "@/server/auth/scope";
import { listCandidateDocuments } from "@/server/services/document.service";
import { DocumentsGrid } from "@/components/documents/documents-grid";
import { ReviewPanel } from "./review-panel";
import { ReviewTimeline } from "./review-timeline";
import { ReviewStatusBadge } from "@/components/review-status-badge";
import { getReviewTimeline, twoStepEnabled } from "@/server/services/review.service";
import { DOCUMENT_DEFS, type DocumentKind } from "@di/core";
import { prisma } from "@di/db";
import { formatDate, formatDateTime, initials, maskTail } from "@/lib/format";
import { hasPermission } from "@/lib/rbac";

export const metadata: Metadata = { title: "Record details" };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-4 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value ?? "—"}</dd>
    </div>
  );
}

export default async function CandidateDetailPage({ params }: PageProps<"/candidates/[id]">) {
  const user = await requireUser("candidates:read");
  const { id } = await params;
  if (!/^[a-z0-9]{1,40}$/i.test(id)) notFound();
  const c = await getCandidate(id, user);
  if (!c) {
    await recordAccessDeniedIfExists(user, id, "candidate_detail");
    notFound();
  }
  const canSeeContact = hasPermission(user.permissions, "candidates:read_contact");
  const canSeeDocuments = hasPermission(user.permissions, "documents:read");
  const [documents, policies] = await Promise.all([
    canSeeDocuments ? listCandidateDocuments(c.id, user) : Promise.resolve([]),
    prisma.documentPolicy.findMany({ where: { sourceConnectionId: c.sourceConnectionId, allowed: false }, select: { kind: true } }),
  ]);
  const [timeline, twoStep] = await Promise.all([getReviewTimeline(c.id, user), twoStepEnabled()]);
  const pendingReview = timeline.reviews.find((r) => r.requiresConfirmation && !r.confirmedAt) ?? null;
  const photo = documents.find((d) => d.kind === "PROFILE_PHOTO" && d.previewUrl);
  const files = documents.filter((d) => d.kind !== "PROFILE_PHOTO");
  const notApproved = policies.map((p) => DOCUMENT_DEFS[p.kind as DocumentKind]?.label ?? p.kind);

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-4 -ml-2">
        <Link href="/candidates">
          <ArrowLeft /> Back to records
        </Link>
      </Button>

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Card>
          <CardContent className="flex flex-col items-center text-center">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo.previewUrl} alt={`Photo of ${c.fullName}`} className="size-32 rounded-2xl object-cover ring-2 ring-accent" />
            ) : (
              <Avatar className="size-20">
                <AvatarFallback className="bg-brand-navy text-xl font-semibold text-white">{initials(c.fullName)}</AvatarFallback>
              </Avatar>
            )}
            <h1 className="mt-4 text-lg font-bold text-brand-navy">{c.fullName}</h1>
            <p className="mt-1 text-xs font-semibold uppercase text-muted-foreground">{c.designation?.name ?? "—"}</p>
            <p className="text-xs uppercase text-muted-foreground">{c.departmentHead?.name}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              <Badge variant="secondary">{c.sourceEmployeeCode}</Badge>
              <ReviewStatusBadge status={c.reviewStatus} updated={c.reviewUpdated} pendingConfirmation={c.reviewPendingConfirmation} />
              {c.isPresent != null && (
                <Badge className={c.isPresent ? "border-0 bg-success/10 text-success" : "border-0 bg-muted text-muted-foreground"}>
                  {c.isPresent ? "Present" : "Not present"}
                </Badge>
              )}
            </div>
            <dl className="mt-6 w-full divide-y text-left">
              <Row label="District" value={c.district?.name} />
              <Row label="Taluka" value={c.taluka} />
              <Row label="Last synced" value={formatDateTime(c.lastSyncedAt)} />
            </dl>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {hasPermission(user.permissions, "reviews:read") && (
            <ReviewPanel
              candidateId={c.id}
              candidateName={c.fullName}
              status={c.reviewStatus}
              updated={c.reviewUpdated}
              pendingConfirmation={c.reviewPendingConfirmation}
              pendingReviewId={pendingReview?.id ?? null}
              can={{
                decide: hasPermission(user.permissions, "reviews:decide"),
                override: hasPermission(user.permissions, "reviews:override"),
                confirm: hasPermission(user.permissions, "reviews:confirm"),
                comment: hasPermission(user.permissions, "comments:write"),
              }}
              isDistrictViewer={user.role === "DISTRICT_VIEWER"}
              twoStep={twoStep}
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle>Employment</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Row label="Department / Project" value={c.departmentHead?.name} />
                <Row label="Department" value={c.department?.name} />
                <Row label="Sub-Project" value={c.subProject?.name} />
                <Row label="Designation" value={c.designation?.name} />
                <Row label="Type of employee" value={c.employeeType} />
                <Row label="Date of joining" value={formatDate(c.joiningDate)} />
                <Row label="Leaving date" value={c.leavingDate ? formatDate(c.leavingDate) : "—"} />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Profile & verification</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Row label="Gender" value={c.gender} />
                <Row label="Education type" value={c.educationType} />
                <Row label="Status at source" value={c.sourceStatus} />
                <Row label="Document verification" value={c.docVerificationStatus} />
                <Row label="Office verification" value={c.officeVerificationStatus} />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contact</CardTitle>
            </CardHeader>
            <CardContent>
              {canSeeContact ? (
                <dl className="divide-y">
                  <Row label="Mobile" value={maskTail(c.profile?.mobile)} />
                  <Row label="Official email" value={c.profile?.officialEmail ?? "—"} />
                </dl>
              ) : (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Lock className="size-4" /> Contact details are restricted for your role.
                </p>
              )}
            </CardContent>
          </Card>

          {canSeeDocuments && <DocumentsGrid documents={files} notApproved={notApproved} />}

          {hasPermission(user.permissions, "reviews:read") && <ReviewTimeline reviews={timeline.reviews} comments={timeline.comments} />}

          <p className="text-xs text-muted-foreground">
            Source: {c.sourceConnection.name}. Sensitive identity, bank and personal fields are not collected.
          </p>
        </div>
      </div>
    </>
  );
}
