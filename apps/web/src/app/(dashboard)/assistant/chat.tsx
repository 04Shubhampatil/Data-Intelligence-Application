"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, Bot, Download, Loader2, SendHorizonal, Sparkles, User } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { withBase } from "@/lib/base-path";

type Table = { resultId: string; title: string; columns: { key: string; label: string }[]; rows: Record<string, string | number | null>[]; total: number; exportable: boolean };
type CardData = { label: string; value: string | number; hint?: string };
type Message = { id: string; role: "user" | "assistant"; content: string; tables?: Table[]; cards?: CardData[]; error?: boolean };

const EXAMPLES = [
  "Show all candidates from Buldhana district",
  "How many candidates belong to PMAY?",
  "Count candidates by designation",
  "Find candidates with the Rural Housing Engineer designation",
  "Generate an Excel report of candidates by district",
  "Show the latest synchronization status",
];

export function Chat({ userName }: { userName: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || pending) return;
    const next: Message[] = [...messages, { id: crypto.randomUUID(), role: "user", content }];
    setMessages(next);
    setInput("");
    setPending(true);
    try {
      const res = await fetch(withBase("/api/assistant/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.filter((m) => !m.error).slice(-10).map((m) => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", content: data.answer, tables: data.tables, cards: data.cards }]);
    } catch (err) {
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", content: err instanceof Error ? err.message : "Something went wrong.", error: true }]);
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex h-[calc(100vh-11rem)] min-h-[32rem] flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto pr-1">
        {messages.length === 0 && (
          <Card className="mx-auto max-w-2xl p-6 text-center">
            <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-accent text-brand-teal">
              <Sparkles className="size-6" />
            </div>
            <h2 className="text-lg font-semibold">Ask about the synced records</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Answers come only from this application&apos;s database. The assistant can read approved fields; it cannot change anything or see contact, identity or bank details.
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {EXAMPLES.map((e) => (
                <button key={e} type="button" onClick={() => send(e)} className="rounded-lg border bg-card px-3 py-2 text-left text-sm transition-colors hover:border-brand-teal hover:bg-accent">
                  {e}
                </button>
              ))}
            </div>
          </Card>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} userName={userName} />
        ))}

        {pending && (
          <div className="flex items-start gap-3">
            <Avatar role="assistant" />
            <div className="rounded-2xl rounded-tl-sm border bg-card px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="mr-2 inline size-4 animate-spin" /> Looking that up…
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="mt-4 flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-xs"
      >
        <Textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          placeholder="Ask a question, e.g. “How many candidates in Kolhapur?”"
          rows={1}
          maxLength={2000}
          aria-label="Your question"
          className="max-h-40 min-h-10 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <Button type="submit" size="icon" disabled={pending || !input.trim()} aria-label="Send">
          <SendHorizonal />
        </Button>
      </form>
    </div>
  );
}

/** Renders the model's light markdown: **bold** and `code`. Everything else is plain text (no HTML). */
function Emphasis({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong>
        ) : p.startsWith("`") && p.endsWith("`") ? (
          <code key={i} className="rounded bg-muted px-1 font-mono text-[12px]">{p.slice(1, -1)}</code>
        ) : (
          p
        ),
      )}
    </>
  );
}

function Avatar({ role }: { role: "user" | "assistant" }) {
  return (
    <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", role === "assistant" ? "bg-brand-navy text-white" : "bg-accent text-brand-navy")}>
      {role === "assistant" ? <Bot className="size-4" /> : <User className="size-4" />}
    </div>
  );
}

function MessageBubble({ message: m, userName }: { message: Message; userName: string }) {
  const isUser = m.role === "user";
  return (
    <div className={cn("flex items-start gap-3", isUser && "flex-row-reverse")}>
      <Avatar role={m.role} />
      <div className={cn("min-w-0 max-w-full space-y-3", isUser ? "items-end" : "flex-1")}>
        <div className="text-[11px] text-muted-foreground">{isUser ? userName : "Assistant"}</div>
        {m.error ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{m.content}</AlertDescription>
          </Alert>
        ) : (
          <div className={cn("whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed", isUser ? "rounded-tr-sm bg-brand-navy text-white" : "rounded-tl-sm border bg-card")}>
            {isUser ? m.content : <Emphasis text={m.content} />}
          </div>
        )}
        {!!m.cards?.length && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {m.cards.map((c, i) => (
              <Card key={i} className="gap-0 px-4 py-3">
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className="truncate text-xl font-bold tabular-nums text-foreground" title={String(c.value)}>
                  {typeof c.value === "number" ? formatNumber(c.value) : c.value}
                </p>
                {c.hint && <p className="truncate text-[11px] text-muted-foreground" title={c.hint}>{c.hint}</p>}
              </Card>
            ))}
          </div>
        )}
        {m.tables?.map((t) => <ResultTable key={t.resultId + t.title} table={t} />)}
      </div>
    </div>
  );
}

function ResultTable({ table: t }: { table: Table }) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" title={t.title}>{t.title}</p>
          <p className="text-xs text-muted-foreground">
            {t.rows.length < t.total ? `Showing ${formatNumber(t.rows.length)} of ${formatNumber(t.total)}` : `${formatNumber(t.total)} row${t.total === 1 ? "" : "s"}`}
          </p>
        </div>
        {t.exportable && (
          <Button size="sm" variant="outline" asChild>
            <a href={withBase(`/api/exports/${t.resultId}`)} download>
              <Download /> Export Excel
            </a>
          </Button>
        )}
      </div>
      {t.rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">No matching records.</p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 border-b bg-muted text-left text-[11px] font-semibold text-foreground">
              <tr>
                {t.columns.map((c) => (
                  <th key={c.key} className="whitespace-nowrap px-3 py-2 font-semibold">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {t.rows.map((r, i) => (
                <tr key={i} className="hover:bg-accent/40">
                  {t.columns.map((c) => (
                    <td key={c.key} className={cn("whitespace-nowrap px-3 py-1.5", typeof r[c.key] === "number" && "text-right tabular-nums")}>
                      {c.key === "code" && r[c.key] ? (
                        <Link href={`/candidates?q=${encodeURIComponent(String(r[c.key]))}`} className="font-mono text-xs text-primary hover:underline">{r[c.key]}</Link>
                      ) : typeof r[c.key] === "number" ? (
                        formatNumber(r[c.key] as number)
                      ) : (
                        (r[c.key] ?? "—")
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
