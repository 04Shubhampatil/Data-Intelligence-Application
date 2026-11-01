/**
 * One-off capability probe for the configured AI endpoint (no candidate data is sent).
 * Checks: plain completion, tool calling (function call + tool result round-trip), JSON output.
 *   npx tsx apps/web/scripts/probe-ai.ts
 */
import path from "node:path";
import { config } from "dotenv";
import OpenAI from "openai";

config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL });
const model = process.env.OPENAI_MODEL!;
console.log("model:", model, "base:", process.env.OPENAI_BASE_URL);

const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "count_candidates",
      description: "Count candidate records, optionally filtered by district.",
      parameters: { type: "object", properties: { district: { type: "string", description: "District name, upper case" } }, additionalProperties: false },
    },
  },
];

const t0 = Date.now();
const first = await client.chat.completions.create({
  model,
  messages: [
    { role: "system", content: "You answer questions about an HR database using the provided tools. Always call a tool before answering with numbers." },
    { role: "user", content: "How many candidates are from Kolhapur district?" },
  ],
  tools,
  tool_choice: "auto",
  temperature: 0,
  max_tokens: 400,
});
const msg = first.choices[0].message;
console.log(`\n[1] first turn in ${Date.now() - t0} ms  finish=${first.choices[0].finish_reason}`);
console.log("    tool_calls:", JSON.stringify(msg.tool_calls?.map((c) => c.type === "function" && { name: c.function.name, args: c.function.arguments })));
console.log("    content:", JSON.stringify((msg.content ?? "").slice(0, 200)));
console.log("    reasoning_content present:", "reasoning_content" in msg);

const call = msg.tool_calls?.[0];
if (!call || call.type !== "function") {
  console.log("\nRESULT: model did NOT call the tool.");
  process.exit(1);
}
const t1 = Date.now();
const second = await client.chat.completions.create({
  model,
  messages: [
    { role: "system", content: "You answer questions about an HR database using the provided tools." },
    { role: "user", content: "How many candidates are from Kolhapur district?" },
    { role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls },
    { role: "tool", tool_call_id: call.id, content: JSON.stringify({ count: 42, district: "KOLHAPUR" }) },
  ],
  tools,
  temperature: 0,
  max_tokens: 300,
});
console.log(`\n[2] second turn in ${Date.now() - t1} ms`);
console.log("    answer:", JSON.stringify((second.choices[0].message.content ?? "").slice(0, 300)));
console.log("\nRESULT: tool calling works:", /42/.test(second.choices[0].message.content ?? ""));
