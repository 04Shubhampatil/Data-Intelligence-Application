"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { NavItem } from "@/lib/rbac";
import { Brand } from "./brand";
import { SidebarNav } from "./sidebar-nav";

export function MobileNav({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="lg:hidden" aria-label="Open menu">
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-4">
        <SheetHeader className="p-0 pb-4">
          <SheetTitle asChild>
            <div>
              <Brand />
            </div>
          </SheetTitle>
        </SheetHeader>
        <SidebarNav items={items} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
