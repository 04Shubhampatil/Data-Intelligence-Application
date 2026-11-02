import type { Metadata } from "next";
import Link from "next/link";
import { Inbox, MessageSquare } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/pagination";
import { EmptyState } from "@/components/empty-state";
import { MessageKindBadge } from "@/components/message-kind-badge";
import { requireUser } from "@/server/auth/session";
import { composeOptions, listThreads } from "@/server/services/message.service";
import { formatDateTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ComposeDialog } from "./compose-dialog";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage({ searchParams }: PageProps<"/messages">) {
  const user = await requireUser("messages:read");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const [threads, districts] = await Promise.all([listThreads(user, { page }), composeOptions(user)]);

  return (
    <>
      <PageHeader
        title="Messages"
        description="Messages, announcements and reminders between District Admins and District Viewers."
        actions={<ComposeDialog districts={districts} />}
      />
      <Card className="overflow-hidden py-0">
        <CardHeader className="border-b py-4">
          <CardTitle>Threads</CardTitle>
          <CardDescription>{threads.total} thread{threads.total === 1 ? "" : "s"}. Read receipts show how many recipients have opened a message.</CardDescription>
        </CardHeader>
        {threads.rows.length === 0 ? (
          <EmptyState icon={Inbox} title="No messages yet" description={districts.length ? "Send the first message to your district." : "Messages from your District Admin will appear here."} />
        ) : (
          <ul className="divide-y" role="list">
            {threads.rows.map((m) => (
              <li key={m.id}>
                <Link href={`/messages/${m.id}`} className={cn("flex flex-wrap items-start justify-between gap-3 px-4 py-3 hover:bg-accent/30", m.unreadForMe && "bg-accent/20")}>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      {m.unreadForMe && <span className="size-2 rounded-full bg-brand-orange" aria-label="Unread" />}
                      <span className={cn("truncate", m.unreadForMe ? "font-semibold" : "font-medium")}>{m.subject}</span>
                      <MessageKindBadge kind={m.kind} />
                    </p>
                    <p className="truncate text-sm text-muted-foreground">{m.body}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {m.sender.name ?? m.sender.email} · {m.district.name} · {formatDateTime(m.createdAt)}
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p><MessageSquare className="mr-1 inline size-3" />{m._count.replies} repl{m._count.replies === 1 ? "y" : "ies"}</p>
                    <p>Read by {m.readCount}/{m.recipientCount}</p>
                    <p>{relativeTime(m.createdAt)}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t px-4 py-3">
          <Pagination page={threads.page} pageCount={threads.pageCount} total={threads.total} pageSize={threads.pageSize} hrefFor={(p) => `/messages?page=${p}`} />
        </div>
      </Card>
    </>
  );
}
