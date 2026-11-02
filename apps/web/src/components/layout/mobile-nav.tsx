"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { NavItem } from "@/lib/rbac";
import { SidebarContent, type SidebarUser } from "./app-sidebar";

/** Hamburger + slide-in navy sidebar on small screens. */
export function MobileNav({ items, badges, user, showAssistant }: { items: NavItem[]; badges?: Record<string, number>; user: SidebarUser; showAssistant: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 border-0 p-0" showCloseButton={false}>
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SidebarContent items={items} badges={badges} user={user} showAssistant={showAssistant} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
