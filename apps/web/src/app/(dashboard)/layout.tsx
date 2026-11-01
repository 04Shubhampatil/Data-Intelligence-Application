import { requireUser } from "@/server/auth/session";
import { navFor } from "@/lib/rbac";
import { Brand } from "@/components/layout/brand";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { MobileNav } from "@/components/layout/mobile-nav";
import { UserMenu } from "@/components/layout/user-menu";
import { NotificationsBell } from "@/components/layout/notifications-bell";
import { unreadNotificationCount } from "@/server/services/notification.service";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const items = navFor(user.permissions, user.role);
  const unread = await unreadNotificationCount(user);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 lg:flex">
        <div className="px-1 pb-6 pt-1">
          <Brand />
        </div>
        <SidebarNav items={items} />
        <div className="mt-auto rounded-xl bg-muted p-3 text-[11px] leading-relaxed text-muted-foreground">
          Approved fields only. All searches and exports are logged.
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-card/90 px-4 backdrop-blur sm:px-6">
          <MobileNav items={items} />
          <div className="lg:hidden">
            <Brand />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <NotificationsBell initialUnread={unread} />
            <UserMenu name={user.name} email={user.email} role={user.role} />
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
