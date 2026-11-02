"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardCheck, FileBarChart, LayoutDashboard, Mail, MapPin, RefreshCw, Settings, Sparkles, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/rbac";

const ICONS: Record<string, LucideIcon> = {
  "layout-dashboard": LayoutDashboard,
  users: Users,
  sparkles: Sparkles,
  "refresh-cw": RefreshCw,
  "file-bar-chart": FileBarChart,
  settings: Settings,
  "map-pin": MapPin,
  mail: Mail,
  "clipboard-check": ClipboardCheck,
};

/** Navigation for the navy sidebar. `badges` maps an href to an unread count (e.g. /messages). */
export function SidebarNav({ items, onNavigate, badges = {} }: { items: NavItem[]; onNavigate?: () => void; badges?: Record<string, number> }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1" aria-label="Main">
      {items.map((item) => {
        const Icon = ICONS[item.icon] ?? LayoutDashboard;
        const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const badge = badges[item.href] ?? 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md shadow-blue-950/40"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-4.5 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {badge > 0 && (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white" aria-label={`${badge} unread`}>
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
