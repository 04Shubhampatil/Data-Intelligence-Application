import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCheck, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MessageKindBadge } from "@/components/message-kind-badge";
import { requireUser } from "@/server/auth/session";
import { getThread } from "@/server/services/message.service";
import { formatDateTime, initials, roleLabel } from "@/lib/format";
import { hasPermission } from "@/lib/rbac";
import { ReplyForm } from "../reply-form";

export const metadata: Metadata = { title: "Message" };

function Bubble({ name, role, at, body, mine }: { name: string; role: string; at: Date; body: string; mine: boolean }) {
  return (
    <div className={mine ? "flex flex-row-reverse gap-3" : "flex gap-3"}>
      <Avatar className="size-8 shrink-0">
        <AvatarFallback className={mine ? "bg-brand-teal text-xs font-semibold text-white" : "bg-brand-navy text-xs font-semibold text-white"}>{initials(name)}</AvatarFallback>
      </Avatar>
      <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${mine ? "bg-accent" : "bg-muted"}`}>
        <p className="mb-1 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{name}</span> · {roleLabel(role)} · {formatDateTime(at)}
        </p>
        <p className="whitespace-pre-wrap">{body}</p>
      </div>
    </div>
  );
}

export default async function MessageThreadPage({ params }: PageProps<"/messages/[id]">) {
  const user = await requireUser("messages:read");
  const { id } = await params;
  if (!/^[a-z0-9]{1,40}$/i.test(id)) notFound();
  const t = await getThread(id, user);
  if (!t) notFound();
  const canReply = hasPermission(user.permissions, "messages:reply") || hasPermission(user.permissions, "messages:send");
  const read = t.recipients.filter((r) => r.readAt).length;

  return (
    <>
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild><Link href="/messages"><ArrowLeft /> All messages</Link></Button>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">{t.subject} <MessageKindBadge kind={t.kind} /></CardTitle>
            <CardDescription>{t.district.name} · started by {t.sender.name ?? t.sender.email} on {formatDateTime(t.createdAt)}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Bubble name={t.sender.name ?? t.sender.email} role={t.sender.role.name} at={t.createdAt} body={t.body} mine={t.sender.id === user.id} />
            {t.replies.map((r) => (
              <Bubble key={r.id} name={r.sender.name ?? r.sender.email} role={r.sender.role.name} at={r.createdAt} body={r.body} mine={r.sender.id === user.id} />
            ))}
            {canReply ? (
              <div className="border-t pt-4"><ReplyForm parentId={t.id} /></div>
            ) : (
              <p className="border-t pt-4 text-sm text-muted-foreground">You can read this thread but not reply.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recipients</CardTitle>
            <CardDescription>Read by {read} of {t.recipients.length}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm" role="list">
              {t.recipients.map((r) => (
                <li key={r.userId} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.user.name ?? r.user.email}</p>
                    <p className="text-xs text-muted-foreground">{roleLabel(r.user.role.name)}</p>
                  </div>
                  {r.readAt ? (
                    <span className="inline-flex items-center gap-1 text-xs text-success" title={formatDateTime(r.readAt)}><CheckCheck className="size-3.5" /> Read</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock className="size-3.5" /> Delivered</span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
