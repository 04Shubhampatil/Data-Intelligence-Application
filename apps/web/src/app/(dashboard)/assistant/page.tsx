import type { Metadata } from "next";
import { Bot } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/server/auth/session";
import { aiConfig } from "@/server/ai/client";
import { Chat } from "./chat";

export const metadata: Metadata = { title: "AI Assistant" };

export default async function AssistantPage() {
  const user = await requireUser("assistant:use");
  const ai = aiConfig();
  return (
    <>
      <PageHeader title="AI Assistant" description={`Natural-language questions about synced records · ${ai.provider}`} />
      {ai.configured ? (
        <Chat userName={user.name ?? user.username} />
      ) : (
        <Alert>
          <Bot />
          <AlertTitle>Assistant not configured</AlertTitle>
          <AlertDescription>Set OPENAI_API_KEY (and optionally OPENAI_BASE_URL / OPENAI_MODEL) in the server environment, then restart the app.</AlertDescription>
        </Alert>
      )}
    </>
  );
}
