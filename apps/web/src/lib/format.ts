export function initials(name: string) {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

const ROLE_LABELS: Record<string, string> = { SUPER_ADMIN: "Super Admin", ADMIN: "Admin", VIEWER: "Viewer" };
export function roleLabel(role: string) {
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

const nf = new Intl.NumberFormat("en-IN");
export const formatNumber = (n: number) => nf.format(n);

const dtf = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const df = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" });
export const formatDateTime = (d: Date | string | null | undefined) => (d ? dtf.format(new Date(d)) : "—");
export const formatDate = (d: Date | string | null | undefined) => (d ? df.format(new Date(d)) : "—");

export function relativeTime(d: Date | string, now = Date.now()) {
  const s = Math.round((now - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  return days < 30 ? `${days} d ago` : formatDate(d);
}

/** Masks all but the last 4 digits, e.g. "••••••4447". */
export function maskTail(value: string | null | undefined, keep = 4) {
  if (!value) return "—";
  return value.length <= keep ? value : "•".repeat(value.length - keep) + value.slice(-keep);
}
