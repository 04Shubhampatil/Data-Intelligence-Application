import Link from "next/link";
import { Eye, EyeOff, Lock, Phone } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";

export type ContactCardData = {
  /** Employee ID printed on the source profile card (e.g. E03559). */
  officialEmployeeId: string | null;
  profileCode: string;
  joiningDate: Date | null;
  /** null = the user may not see contact details. */
  contact: { mobile: string | null; whatsapp: string | null; personalEmail: string | null; officialEmail: string | null } | null;
  /** null = no permission to see personal details (reporting officer). */
  officer: { name?: string; designation?: string; district?: string; phone?: string } | null | undefined;
  canSeeOfficer: boolean;
  revealed: boolean;
};

const maskPhone = (v: string) => (v.length <= 4 ? "••••" : `${"•".repeat(Math.min(6, v.length - 4))}${v.slice(-4)}`);
const maskEmail = (v: string) => {
  const [user, domain] = v.split("@");
  return domain ? `${user.slice(0, 2)}${"•".repeat(Math.max(3, Math.min(8, user.length - 2)))}@${domain}` : maskPhone(v);
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(7rem,9rem)_1fr] gap-3 py-2.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium">{children}</dd>
    </div>
  );
}

const dash = <span className="font-normal text-muted-foreground">—</span>;

/**
 * Mirrors the source profile header card: Employee ID, mobile, WhatsApp, personal and official
 * email, date of joining and reporting officer. Phones and emails are masked until the user
 * clicks "Show" (that reveal is audit-logged); each part needs its own permission.
 */
export function ContactCard({ d, revealHref, hideHref }: { d: ContactCardData; revealHref: string; hideHref: string }) {
  const show = (v: string | null | undefined, kind: "phone" | "email") => (!v ? dash : d.revealed ? v : kind === "phone" ? maskPhone(v) : maskEmail(v));
  const hasMaskable = !!(d.contact && (d.contact.mobile || d.contact.whatsapp || d.contact.personalEmail || d.contact.officialEmail)) || !!d.officer?.phone;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Contact & reporting</CardTitle>
          <CardDescription>As shown on the source profile. {hasMaskable ? (d.revealed ? "Showing full details — this view was logged." : "Numbers and emails are masked.") : ""}</CardDescription>
        </div>
        {hasMaskable && (
          <Link href={d.revealed ? hideHref : revealHref} scroll={false} className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline">
            {d.revealed ? <><EyeOff className="size-3.5" /> Mask</> : <><Eye className="size-3.5" /> Show</>}
          </Link>
        )}
      </CardHeader>
      <CardContent>
        <dl className="divide-y">
          <Row label="Employee ID">{d.officialEmployeeId ?? dash} <span className="ml-1 text-xs font-normal text-muted-foreground">(profile {d.profileCode})</span></Row>
          {d.contact ? (
            <>
              <Row label="Mobile No.">{show(d.contact.mobile, "phone")}</Row>
              <Row label="WhatsApp No.">{show(d.contact.whatsapp, "phone")}</Row>
              <Row label="Email (Personal)">{show(d.contact.personalEmail, "email")}</Row>
              <Row label="Email (Official)">{show(d.contact.officialEmail, "email")}</Row>
            </>
          ) : (
            <Row label="Contact">
              <span className="inline-flex items-center gap-1.5 font-normal text-muted-foreground"><Lock className="size-3.5" /> Restricted for your role</span>
            </Row>
          )}
          <Row label="Date of Joining">{d.joiningDate ? formatDate(d.joiningDate) : dash}</Row>
          <Row label="Reporting Officer">
            {!d.canSeeOfficer ? (
              <span className="inline-flex items-center gap-1.5 font-normal text-muted-foreground"><Lock className="size-3.5" /> Restricted for your role</span>
            ) : d.officer?.name ? (
              <span className="block leading-relaxed">
                {d.officer.name}
                {d.officer.designation && <><br />{d.officer.designation}</>}
                {d.officer.district && <><br />{d.officer.district}</>}
                {d.officer.phone && (
                  <>
                    <br />
                    <span className="inline-flex items-center gap-1"><Phone className="size-3.5 text-muted-foreground" />{show(d.officer.phone, "phone")}</span>
                  </>
                )}
              </span>
            ) : (
              dash
            )}
          </Row>
        </dl>
      </CardContent>
    </Card>
  );
}
