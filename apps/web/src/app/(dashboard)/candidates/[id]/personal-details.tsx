import { Lock, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PersonalView } from "@/server/services/personal.service";
import type { PersonalDetails } from "@di/core";
import { formatDateTime } from "@/lib/format";

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-medium">{value ?? "—"}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-t pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-brand-navy">{title}</h3>
      {children}
    </section>
  );
}

const grid = "grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3";

function Details({ d }: { d: PersonalDetails }) {
  return (
    <div className="space-y-5">
      <Section title="Personal">
        <dl className={grid}>
          <Field label="Father's / husband's name" value={d.fatherOrHusbandName} />
          <Field label="Date of birth" value={d.dateOfBirth} />
          <Field label="Marital status" value={d.maritalStatus} />
          <Field label="Blood group" value={d.bloodGroup} />
          <Field label="Address" value={d.address} />
          <Field label="Pincode" value={d.pincode} />
          <Field label="Alternate contact" value={d.alternateContact} />
          <Field label="Emergency contact (name & relation)" value={d.emergencyContactName} />
          <Field label="Emergency contact no." value={d.emergencyContactNo} />
        </dl>
      </Section>

      {/* Reporting officer is shown in the Contact & reporting card. */}

      <Section title="Educational qualification">
        {d.education.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-4 font-medium">Qualification</th>
                  <th className="py-1 pr-4 font-medium">Board / University</th>
                  <th className="py-1 pr-4 font-medium">Year</th>
                  <th className="py-1 font-medium">Marks</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {d.education.map((e, i) => (
                  <tr key={i}>
                    <td className="py-1.5 pr-4">{e.qualification ?? "—"}</td>
                    <td className="py-1.5 pr-4">{e.board ?? "—"}</td>
                    <td className="py-1.5 pr-4">{e.yearOfPassing ?? "—"}</td>
                    <td className="py-1.5">{e.marks ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Not provided at source.</p>
        )}
      </Section>

      <Section title="Previous employment">
        {d.employment.length ? (
          <div className="space-y-4">
            {d.employment.map((e, i) => (
              <dl key={i} className={grid}>
                <Field label={`Employer ${i + 1}`} value={e.employer} />
                <Field label="Designation" value={e.designation} />
                <Field label="Duration" value={e.fromDate || e.toDate ? `${e.fromDate ?? "?"} – ${e.toDate ?? "?"}` : undefined} />
                <Field label="Reason for leaving" value={e.reasonForLeaving} />
                <Field label="Experience letter submitted" value={e.experienceLetterSubmitted} />
                <Field label="Exit processed by employer" value={e.exitProcessed} />
              </dl>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Not provided at source.</p>
        )}
      </Section>

      <Section title="Domicile">
        {d.domicile ? (
          <dl className={grid}>
            <Field label="Place of birth" value={d.domicile.placeOfBirth} />
            <Field label="Native district" value={d.domicile.nativeDistrict} />
            <Field label="Mother tongue" value={d.domicile.motherTongue} />
            <Field label="Permanent address" value={d.domicile.permanentAddress} />
            <Field label="Duration of stay" value={d.domicile.durationOfStay} />
            <Field label="Schooling in the state" value={d.domicile.schoolingInState} />
            <Field label="School name & location" value={d.domicile.schoolNameLocation} />
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Not provided at source.</p>
        )}
      </Section>

      <Section title="Nominee">
        {d.nominees.length ? (
          <div className="space-y-3">
            {d.nominees.map((n, i) => (
              <dl key={i} className={grid}>
                <Field label="Name" value={n.name} />
                <Field label="Relationship" value={n.relationship} />
                <Field label="Date of birth & age" value={n.dateOfBirth} />
                <Field label="Mobile" value={n.mobile} />
              </dl>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Not provided at source.</p>
        )}
      </Section>
    </div>
  );
}

/** "Profile & employment details" card. Server component; values never reach the AI or exports. */
export function PersonalDetailsCard({ view }: { view: PersonalView }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile & employment details</CardTitle>
        <CardDescription>
          {view.state === "ok" && view.syncedAt ? `From the MahaHRD profile, last read ${formatDateTime(view.syncedAt)}. ` : ""}
          Stored encrypted; each view is logged.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {view.state === "ok" ? (
          <Details d={view.details} />
        ) : view.state === "forbidden" ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Lock className="size-4" /> Restricted for your role.</p>
        ) : view.state === "unreadable" ? (
          <p className="flex items-center gap-2 text-sm text-destructive"><ShieldAlert className="size-4" /> Stored details could not be decrypted. Check the encryption key on this server.</p>
        ) : (
          <p className="text-sm text-muted-foreground">Not extracted yet. They are read from the MahaHRD profile page during a sync with profiles.</p>
        )}
      </CardContent>
    </Card>
  );
}
