import Link from "next/link";
import { CalendarDays, Eye, EyeOff, Lock, LifeBuoy, MapPin, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { GroupView } from "@/server/services/sensitive.service";
import { formatDateTime } from "@/lib/format";

const FIELD_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp", personalEmail: "Personal email",
  aadhaarLast4: "Aadhaar (last 4 digits)", aadhaarName: "Name as on Aadhaar", pan: "PAN", panName: "Name as on PAN", panFatherName: "Father's name as on PAN",
  bank: "Bank", branch: "Branch", accountHolder: "Account holder", accountNumber: "Account no.", ifsc: "IFSC", upi: "UPI ID",
  uan: "UAN", previousPfNo: "Previous PF no.", previousEmployer: "Previous employer", pfExitDate: "PF exit date", pfNomineeName: "PF nominee",
  pfNomineeDob: "PF nominee DOB", nomineeRelationship: "Nominee relationship", pfDeductionChoice: "PF deduction choice", esicCovered: "Covered under ESIC",
  esicIpNo: "ESIC IP no.", previousEsicCode: "Previous employer ESIC code",
  fatherName: "Father's name", fatherDob: "Father's DOB", fatherOccupation: "Father's occupation", motherName: "Mother's name", motherDob: "Mother's DOB",
  motherOccupation: "Mother's occupation", spouseName: "Spouse", spouseOccupation: "Spouse occupation", childrenCount: "No. of children", dependants: "Dependants",
  religion: "Religion", category: "Category", caste: "Caste", subCaste: "Sub-caste", casteCertificateIssuedBy: "Caste certificate issued by", disability: "Disability",
};

function Value({ v }: { v: unknown }) {
  if (v === undefined || v === null || v === "") return <span className="text-muted-foreground">—</span>;
  return <>{String(v)}</>;
}

function GroupBody({ g }: { g: Extract<GroupView, { state: "ok" }> }) {
  const d = g.data;
  const scalars = Object.entries(d).filter(([, v]) => !Array.isArray(v));
  const lists = Object.entries(d).filter(([, v]) => Array.isArray(v) && (v as unknown[]).length) as [string, Record<string, unknown>[]][];
  return (
    <div className="space-y-3">
      {scalars.length > 0 && (
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {scalars.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{FIELD_LABELS[k] ?? k}</dt>
              <dd className="break-words text-sm font-medium"><Value v={v} /></dd>
            </div>
          ))}
        </dl>
      )}
      {lists.map(([k, rows]) => (
        <div key={k} className="overflow-x-auto">
          <p className="mb-1 text-xs font-semibold text-muted-foreground">{k === "others" ? "Other identity documents" : k === "children" ? "Children" : k === "previous" ? "Previous employers" : k}</p>
          <table className="w-full min-w-[420px] text-sm">
            <tbody className="divide-y">
              {rows.map((r, i) => (
                <tr key={i}>{Object.values(r).map((v, j) => <td key={j} className="py-1 pr-4"><Value v={v} /></td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/**
 * Sensitive groups. Rendered on the server: groups the user may not see are never decrypted or sent.
 * Identifiers are masked; "Show" re-renders with ?reveal=<group> (audited).
 */
export function SensitiveSections({ groups, candidateId, revealed }: { groups: GroupView[]; candidateId: string; revealed: string[] }) {
  const visible = groups.filter((g) => g.state !== "forbidden");
  if (!visible.length) return null;
  const href = (group: string, on: boolean) => {
    const next = new Set(revealed);
    if (on) next.add(group);
    else next.delete(group);
    return next.size ? `/candidates/${candidateId}?reveal=${[...next].join(",")}` : `/candidates/${candidateId}`;
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Lock className="size-4" /> Sensitive details</CardTitle>
        <CardDescription>Stored encrypted. Never sent to the AI assistant or included in exports. Every view is logged; showing a masked number is logged separately.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {visible.map((g) => (
          <section key={g.group} className="space-y-2 border-t pt-4 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-brand-navy">{g.label}</h3>
              {g.state === "ok" && g.canReveal && (
                <Link href={href(g.group, g.masked)} scroll={false} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  {g.masked ? <><Eye className="size-3.5" /> Show full numbers</> : <><EyeOff className="size-3.5" /> Mask again</>}
                </Link>
              )}
            </div>
            {g.state === "ok" ? (
              <>
                <GroupBody g={g} />
                <p className="text-[11px] text-muted-foreground">Read from the source {formatDateTime(g.syncedAt)}</p>
              </>
            ) : g.state === "unreadable" ? (
              <p className="flex items-center gap-2 text-sm text-destructive"><ShieldAlert className="size-4" /> Stored data could not be decrypted.</p>
            ) : (
              <p className="text-sm text-muted-foreground">Not provided at the source, or not synced yet.</p>
            )}
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

type AttendanceRow = { year: number; month: number; present: number; absent: number; halfDay: number; lateMark: number; weeklyOff: number; holiday: number; attendanceOut: number; workingDays: number; daysInMonth: number; days: unknown; syncedAt: Date };

export function AttendanceCard({ months }: { months: AttendanceRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CalendarDays className="size-4" /> Attendance</CardTitle>
        <CardDescription>Monthly summary from the source attendance calendar (current month is refreshed on each profile sync).</CardDescription>
      </CardHeader>
      <CardContent>
        {months.length === 0 ? (
          <p className="text-sm text-muted-foreground">No attendance synced yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  {["Month", "Present", "Absent", "Half day", "Late mark", "Weekly off", "Holiday", "Attendance out", "Working days", "Days"].map((h) => <th key={h} className="py-1 pr-3 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y">
                {months.map((m) => (
                  <tr key={`${m.year}-${m.month}`}>
                    <td className="py-1.5 pr-3 font-medium">{new Date(m.year, m.month - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}</td>
                    {[m.present, m.absent, m.halfDay, m.lateMark, m.weeklyOff, m.holiday, m.attendanceOut, m.workingDays, m.daysInMonth].map((v, i) => <td key={i} className="py-1.5 pr-3 tabular-nums">{v}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-muted-foreground">Last read {formatDateTime(months[0].syncedAt)}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type TicketRowView = { id: string; ticketNumber: string | null; type: string | null; subject: string | null; priority: string | null; status: string | null; feedback: string | null; syncedAt: Date };

export function TicketsCard({ tickets }: { tickets: TicketRowView[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><LifeBuoy className="size-4" /> Tickets</CardTitle>
        <CardDescription>Support tickets raised by the employee at the source (list only; ticket conversations are not copied).</CardDescription>
      </CardHeader>
      <CardContent>
        {tickets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tickets.</p>
        ) : (
          <ul className="divide-y text-sm" role="list">
            {tickets.map((t) => (
              <li key={t.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="font-medium">{t.subject ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">{t.ticketNumber ?? "—"} · {t.type ?? "—"} · priority {t.priority ?? "—"}</p>
                  {t.feedback && <p className="text-xs text-muted-foreground">Feedback: {t.feedback}</p>}
                </div>
                {t.status && <Badge className="border-0 bg-accent text-brand-navy">{t.status}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function OfficeLocation({ lat, lng }: { lat: number; lng: number }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <MapPin className="size-3.5" /> Office location: {lat.toFixed(5)}, {lng.toFixed(5)}
    </p>
  );
}
