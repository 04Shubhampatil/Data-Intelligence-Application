import { z } from "zod";
import { authorizeApi } from "@/server/auth/session";
import { aiConfig } from "@/server/ai/client";
import { runAgent } from "@/server/ai/agent";
import { rateLimit } from "@/server/security/rate-limit";
import { audit } from "@/server/security/audit";

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(20)
    .refine((m) => m[m.length - 1].role === "user", { message: "Last message must be from the user" }),
});

export async function POST(request: Request) {
  const { user, error } = await authorizeApi("assistant:use");
  if (error) return error;
  if (!aiConfig().configured) return Response.json({ error: "The AI assistant is not configured on this server." }, { status: 503 });

  const rl = rateLimit(`assistant:${user.id}`, 30, 10 * 60_000);
  if (!rl.ok) return Response.json({ error: "Too many questions in a short time. Please wait a few minutes." }, { status: 429 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });

  try {
    const reply = await runAgent(parsed.data.messages, user);
    // Audit records which tools ran, not the question text (it may contain names).
    await audit("AI_QUERY", { userId: user.id, metadata: { tools: reply.toolsUsed, rounds: reply.rounds, ms: reply.ms, tables: reply.tables.length } });
    return Response.json(reply);
  } catch (err) {
    console.error("[assistant]", err instanceof Error ? err.message : err);
    return Response.json({ error: "The assistant could not answer right now. Please try again." }, { status: 502 });
  }
}
