"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Item = { id: string; type: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string };

const POLL_MS = 60_000;

/** Header bell: polls /api/notifications, shows unread count, marks read on open. */
export function NotificationsBell({ initialUnread }: { initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { items: Item[]; unread: number };
      setItems(data.items);
      setUnread(data.unread);
    } catch {
      /* offline — keep the last known state */
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  const markAll = async () => {
    try {
      await fetch("/api/notifications", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      setItems((xs) => xs.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })));
      setUnread(0);
    } catch {
      /* ignore */
    }
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void load();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative size-10 rounded-full" aria-label={unread ? `${unread} unread notifications` : "Notifications"}>
          <Bell />
          {unread > 0 && (
            <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-background" aria-hidden>
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAll} disabled={!unread}>
            <CheckCheck /> Mark all read
          </Button>
        </div>
        <DropdownMenuSeparator className="m-0" />
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing to see yet.</p>
          ) : (
            items.map((n) => (
              <DropdownMenuItem key={n.id} asChild className={cn("items-start rounded-none px-3 py-2.5", !n.readAt && "bg-accent/40")}>
                <Link href={n.link ?? "#"} onClick={() => setOpen(false)}>
                  <div className="min-w-0">
                    <p className={cn("text-sm leading-snug", !n.readAt && "font-semibold")}>{n.title}</p>
                    {n.body && <p className="truncate text-xs text-muted-foreground">{n.body}</p>}
                    <p className="text-[11px] text-muted-foreground">{relativeTime(n.createdAt)}</p>
                  </div>
                </Link>
              </DropdownMenuItem>
            ))
          )}
        </div>
        <DropdownMenuSeparator className="m-0" />
        <DropdownMenuItem asChild className="justify-center rounded-none text-xs">
          <Link href="/messages" onClick={() => setOpen(false)}>Open messages</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
