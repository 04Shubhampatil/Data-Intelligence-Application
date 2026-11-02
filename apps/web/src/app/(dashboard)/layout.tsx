import { requireUser } from "@/server/auth/session";
import { hasPermission, navFor } from "@/lib/rbac";
import { Brand } from "@/components/layout/brand";
import { SidebarContent } from "@/components/layout/app-sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { UserMenu } from "@/components/layout/user-menu";
import { NotificationsBell } from "@/components/layout/notifications-bell";
import { GlobalSearch } from "@/components/layout/global-search";
import { unreadNotificationCount } from "@/server/services/notification.service";
import { unreadMessageCount } from "@/server/services/message.service";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const items = navFor(user.permissions, user.role);
  const [unread, unreadMessages] = await Promise.all([
    unreadNotificationCount(user),
    hasPermission(user.permissions, "messages:read") ? unreadMessageCount(user) : Promise.resolve(0),
  ]);
  const badges = { "/messages": unreadMessages };
  const sidebarUser = { name: user.name, email: user.email };
  const showAssistant = hasPermission(user.permissions, "assistant:use");

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-66 shrink-0 lg:block">
        <SidebarContent items={items} badges={badges} user={sidebarUser} showAssistant={showAssistant} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-18 items-center gap-3 border-b border-border/60 bg-background/85 px-4 backdrop-blur sm:px-6 lg:px-8">
          <MobileNav items={items} badges={badges} user={sidebarUser} showAssistant={showAssistant} />
          <div className="lg:hidden">
            <Brand />
          </div>
          {hasPermission(user.permissions, "candidates:read") && <GlobalSearch />}
          <div className="ml-auto flex items-center gap-3">
            <NotificationsBell initialUnread={unread} />
            <UserMenu name={user.name} email={user.email} role={user.role} />
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
