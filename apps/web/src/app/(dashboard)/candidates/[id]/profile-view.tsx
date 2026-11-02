import Link from "next/link";
import {
  Activity, Briefcase, Building2, CalendarDays, CalendarCheck2, CheckCircle2, ClipboardList, Clock, Download, Eye, FileText, FolderOpen,
  GraduationCap, History, LifeBuoy, MapPin, MessageSquare, ShieldCheck, UserRound, XCircle, type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReviewStatusBadge } from "@/components/review-status-badge";
import type { DocumentView } from "@/server/services/document.service";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/* ───────────── shared bits ───────────── */

export function KV({ rows, narrow }: { rows: [string, React.ReactNode][]; narrow?: boolean }) {
  return (
    <dl className="space-y-2.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className={cn("grid gap-3", narrow ? "grid-cols-[6.5rem_1fr]" : "grid-cols-[8.5rem_1fr]")}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words font-medium text-foreground">{v ?? <span className="font-normal text-muted-foreground">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CardTitleIcon({ icon: Icon, title, action }: { icon: LucideIcon; title: string; action?: React.ReactNode }) {
  return (
    <CardHeader className="flex flex-row items-center justify-between gap-3">
      <CardTitle className="flex items-center gap-2.5 text-base"><Icon className="size-5 text-primary" />{title}</CardTitle>
      {action}
    </CardHeader>
  );
}

export const linkMore = (href: string, label = "View All") => (
  <Link href={href} scroll={false} className="text-sm font-medium text-primary hover:underline">{label} →</Link>
);

const StatusPill = ({ children, tone = "success" }: { children: React.ReactNode; tone?: "success" | "muted" | "warning" }) => (
  <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", tone === "success" ? "bg-emerald-100 text-emerald-700" : tone === "warning" ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground")}>
    {tone === "success" && <span className="size-1.5 rounded-full bg-emerald-600" aria-hidden />}
    {children}
  </span>
);

export function sourceStatusTone(s: string | null | undefined): "success" | "muted" | "warning" {
  if (!s) return "muted";
  return /active/i.test(s) ? "success" : /inactive|left|resign|terminat/i.test(s) ? "warning" : "muted";
}

/* ───────────── left column ───────────── */

export function ProfileSidebar(p: {
  name: string;
  employeeId: string;
  sourceStatus: string | null;
  photoUrl: string | null;
  district: string | null;
  lines: { icon: LucideIcon; text: string | null | undefined }[];
  review: { status: string; updated: boolean; pendingConfirmation: boolean; latest: { label: string; by: string; at: string } | null } | null;
  quick: { href: string; label: string; icon: LucideIcon }[];
}) {
  return (
    <div className="space-y-6">
      <Card className="gap-0 py-6">
        <CardContent className="px-6">
          <div className="relative mx-auto w-fit">
            {p.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.photoUrl} alt={`Photo of ${p.name}`} className="size-36 rounded-full object-cover ring-4 ring-accent" />
            ) : (
              <div className="grid size-36 place-items-center rounded-full bg-muted text-muted-foreground ring-4 ring-accent"><UserRound className="size-16" /></div>
            )}
            {p.sourceStatus && (
              <span className="absolute -right-4 top-0"><StatusPill tone={sourceStatusTone(p.sourceStatus)}>{p.sourceStatus}</StatusPill></span>
            )}
          </div>
          <h1 className="mt-4 text-center text-xl font-bold text-foreground">{p.name}</h1>
          <p className="text-center text-sm text-muted-foreground">{p.employeeId}</p>
          {p.district && (
            <p className="mt-2 flex justify-center">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground"><MapPin className="size-3.5" />{p.district} District</span>
            </p>
          )}
          <ul className="mt-5 space-y-3 border-t pt-5 text-sm" role="list">
            {p.lines.filter((l) => l.text).map((l, i) => (
              <li key={i} className="flex items-start gap-3"><l.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span className="font-medium text-foreground">{l.text}</span></li>
            ))}
          </ul>
          {p.review && (
            <div className="mt-5 border-t pt-5">
              <p className="mb-2 text-sm font-semibold text-foreground">Review Status</p>
              <ReviewStatusBadge status={p.review.status} updated={p.review.updated} pendingConfirmation={p.review.pendingConfirmation} />
              {p.review.latest && <p className="mt-2 text-xs text-muted-foreground">{p.review.latest.label} by {p.review.latest.by} · {p.review.latest.at}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* On smaller screens these duplicate the tab bar, so they only appear beside the content (xl+). */}
      {p.quick.length > 0 && (
        <Card className="hidden xl:flex">
          <CardHeader><CardTitle className="text-base">Quick Actions</CardTitle></CardHeader>
          <CardContent className="space-y-2.5">
            {p.quick.map((q) => (
              <Link key={q.label} href={q.href} scroll={false} className="flex items-center gap-3 rounded-xl bg-accent/60 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent">
                <q.icon className="size-4.5 text-primary" />{q.label}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="hidden gap-0 bg-accent/50 py-4 xl:flex">
        <CardContent className="flex gap-3 px-5">
          <ShieldCheck className="size-6 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-semibold text-accent-foreground">Secure Access</p>
            <p className="text-xs leading-relaxed text-muted-foreground">Sensitive details are encrypted, shown only to permitted roles, and every view is logged.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ───────────── KPI tiles ───────────── */

export function KpiTiles({ tiles }: { tiles: { icon: LucideIcon; tint: string; label: string; value: string; note: string; good?: boolean }[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((t) => (
        <Card key={t.label} className="gap-0 py-5">
          <CardContent className="px-5">
            <div className={cn("grid size-11 place-items-center rounded-full", t.tint)}><t.icon className="size-5" /></div>
            <p className="mt-3 text-sm text-muted-foreground">{t.label}</p>
            <p className="truncate text-xl font-bold text-foreground" title={t.value}>{t.value}</p>
            <p className={cn("mt-1 inline-flex items-center gap-1 text-xs font-semibold", t.good ? "text-success" : "text-muted-foreground")}>
              {t.good && <CheckCircle2 className="size-3.5" />}{t.note}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ───────────── tabs ───────────── */

export const TABS = [
  { key: "overview", label: "Overview", icon: Building2 },
  { key: "documents", label: "Documents", icon: FileText },
  { key: "attendance", label: "Attendance", icon: CalendarDays },
  { key: "tickets", label: "Tickets", icon: LifeBuoy },
  { key: "activity", label: "Activity", icon: History },
  { key: "comments", label: "Comments", icon: MessageSquare },
] as const;
export type TabKey = (typeof TABS)[number]["key"];

export function TabBar({ active, hrefFor, counts, hidden }: { active: TabKey; hrefFor: (t: TabKey) => string; counts: Partial<Record<TabKey, number>>; hidden: TabKey[] }) {
  return (
    <nav className="-mx-1 overflow-x-auto rounded-2xl border bg-card px-1 shadow-card" aria-label="Profile sections">
      <ul className="flex min-w-max" role="list">
        {TABS.filter((t) => !hidden.includes(t.key)).map((t) => (
          <li key={t.key}>
            <Link
              href={hrefFor(t.key)}
              scroll={false}
              aria-current={active === t.key ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 border-b-2 px-4 py-3.5 text-sm font-medium transition-colors",
                active === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon className="size-4" />{t.label}
              {counts[t.key] ? <span className="rounded-full bg-accent px-1.5 text-[11px] font-bold text-accent-foreground">{counts[t.key]}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ───────────── overview cards ───────────── */

export function DocumentsStrip({ docs, href }: { docs: DocumentView[]; href: string }) {
  const shown = docs.filter((d) => d.status === "STORED").slice(0, 6);
  return (
    <Card>
      <CardTitleIcon icon={FolderOpen} title="Uploaded Documents" action={linkMore(href)} />
      <CardContent>
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents stored yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" role="list">
            {shown.map((d) => (
              <li key={d.id} className="relative rounded-2xl border bg-card p-3 text-center">
                {d.downloadUrl && (
                  <a href={d.downloadUrl} download className="absolute right-2 top-2 grid size-7 place-items-center rounded-lg bg-accent text-primary hover:bg-accent/70" aria-label={`Download ${d.label}`}>
                    <Download className="size-3.5" />
                  </a>
                )}
                <a href={d.previewUrl} target="_blank" rel="noopener noreferrer" className="mx-auto mt-1 grid h-16 w-20 place-items-center overflow-hidden rounded-lg bg-muted">
                  {d.previewUrl && d.mimeType?.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.previewUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <FileText className="size-7 text-muted-foreground" />
                  )}
                </a>
                <p className="mt-2 truncate text-xs font-semibold text-foreground" title={d.label}>{d.label}</p>
                <p className="text-[11px] text-muted-foreground">{(d.mimeType ?? "").split("/").pop()?.toUpperCase()}{d.sizeBytes ? ` · ${formatNumber(Math.round(d.sizeBytes / 1024))} KB` : ""}</p>
                {d.sourceVerification && (
                  <p className={cn("mt-1 inline-flex items-center gap-1 text-[11px] font-semibold", d.sourceVerification === "Verified" ? "text-success" : d.sourceVerification === "Rejected" ? "text-destructive" : "text-muted-foreground")}>
                    {d.sourceVerification === "Verified" ? <CheckCircle2 className="size-3" /> : d.sourceVerification === "Rejected" ? <XCircle className="size-3" /> : <Clock className="size-3" />}
                    {d.sourceVerification}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function AttendanceSummary({ month, href }: { month: { year: number; month: number; present: number; absent: number; halfDay: number; weeklyOff: number } | null; href: string }) {
  const tiles = month
    ? [
        { label: "Present", value: month.present, icon: CheckCircle2, tint: "bg-emerald-100 text-emerald-700" },
        { label: "Absent", value: month.absent, icon: XCircle, tint: "bg-rose-100 text-rose-700" },
        { label: "Half Day", value: month.halfDay, icon: Clock, tint: "bg-amber-100 text-amber-700" },
        { label: "Weekly Off", value: month.weeklyOff, icon: CalendarCheck2, tint: "bg-blue-100 text-blue-700" },
      ]
    : [];
  return (
    <Card>
      <CardTitleIcon icon={CalendarDays} title="Attendance Summary" action={linkMore(href, "View Details")} />
      <CardContent>
        {!month ? (
          <p className="text-sm text-muted-foreground">No attendance synced yet.</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">{new Date(month.year, month.month - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</p>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="list">
              {tiles.map((t) => (
                <li key={t.label} className="rounded-2xl border bg-card p-3">
                  <span className={cn("grid size-8 place-items-center rounded-full", t.tint)}><t.icon className="size-4" /></span>
                  <p className="mt-2 text-xs text-muted-foreground">{t.label}</p>
                  <p className="text-lg font-bold text-foreground">{t.value} <span className="text-xs font-semibold">Day{t.value === 1 ? "" : "s"}</span></p>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export type ActivityItem = { at: Date; text: string; tone: "primary" | "success" | "danger" | "muted" };

export function RecentActivity({ items, href }: { items: ActivityItem[]; href: string }) {
  return (
    <Card>
      <CardTitleIcon icon={Activity} title="Recent Activity" action={linkMore(href)} />
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ol className="space-y-3.5" role="list">
            {items.map((a, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", a.tone === "success" ? "bg-success" : a.tone === "danger" ? "bg-destructive" : a.tone === "primary" ? "bg-primary" : "bg-slate-300")} aria-hidden />
                <span className="min-w-0">
                  <span className="block text-foreground">{a.text}</span>
                  <span className="block text-xs text-muted-foreground">{formatDateTime(a.at)}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export const icons = { Briefcase, Building2, ClipboardList, Eye, FileText, GraduationCap, History, LifeBuoy, CalendarDays, MapPin };
export { formatDate, StatusPill };
