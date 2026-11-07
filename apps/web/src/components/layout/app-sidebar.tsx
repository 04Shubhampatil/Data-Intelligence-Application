import Link from "next/link";
import { ArrowRight, Bot, LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { NavItem } from "@/lib/rbac";
import { initials } from "@/lib/format";
import { logoutAction } from "@/app/(auth)/actions";
import { Brand } from "./brand";
import { SidebarNav } from "./sidebar-nav";

export type SidebarUser = { name: string | null; username: string };

/** Decorative waves at the bottom of the navy sidebar (pure decoration, hidden from assistive tech). */
function Waves() {
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-80 w-full text-blue-500" viewBox="0 0 260 320" preserveAspectRatio="none">
      <path d="M0 120 C 70 60, 150 180, 260 90 L260 320 L0 320Z" fill="currentColor" opacity="0.10" />
      <path d="M0 190 C 90 130, 170 250, 260 170 L260 320 L0 320Z" fill="currentColor" opacity="0.08" />
      <path d="M0 250 C 80 210, 180 300, 260 240 L260 320 L0 320Z" fill="currentColor" opacity="0.07" />
    </svg>
  );
}

/** Navy sidebar contents (shared by the desktop rail and the mobile sheet). */
export function SidebarContent({ items, badges, user, showAssistant, onNavigate }: { items: NavItem[]; badges?: Record<string, number>; user: SidebarUser; showAssistant: boolean; onNavigate?: () => void }) {
  const display = user.name || user.username;
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-linear-to-b from-[#0c1f4f] via-sidebar to-[#081534] p-4 text-sidebar-foreground">
      <Waves />
      <div className="relative px-1.5 pb-7 pt-2">
        <Brand tone="dark" />
      </div>
      <div className="relative">
        <SidebarNav items={items} badges={badges} onNavigate={onNavigate} />
      </div>

      {showAssistant && (
        <div className="relative mt-8 rounded-2xl border border-white/10 bg-white/5 p-4 text-center backdrop-blur-sm">
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-linear-to-br from-sky-400/30 to-blue-600/40 text-sky-200">
            <Bot className="size-6" />
          </div>
          <p className="text-sm font-semibold text-white">Ask AI Assistant</p>
          <p className="mt-1 text-xs leading-relaxed text-white/60">Get insights &amp; reports in natural language</p>
          <Link
            href="/assistant"
            onClick={onNavigate}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-sidebar-primary px-4 py-2 text-xs font-semibold text-white shadow-md shadow-blue-950/40 transition-colors hover:bg-blue-500"
          >
            Open Chat <ArrowRight className="size-3.5" />
          </Link>
        </div>
      )}

      <div className="relative mt-auto border-t border-white/10 pt-4">
        <div className="flex items-center gap-3 px-1.5">
          <Avatar className="size-9">
            <AvatarFallback className="bg-white text-xs font-bold text-brand-navy">{initials(display)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold text-white">{display}</p>
            {user.name && <p className="truncate text-[11px] text-white/55">{user.username}</p>}
          </div>
        </div>
        <form action={logoutAction} className="mt-3">
          <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm text-white/70 transition-colors hover:bg-white/8 hover:text-white">
            <LogOut className="size-4" /> Logout
          </button>
        </form>
      </div>
    </div>
  );
}
