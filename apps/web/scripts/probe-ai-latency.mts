/** Measures first-turn latency with the real tool definitions and a realistic prompt, thinking on vs off. No candidate data. */
import path from "node:path";
import { config } from "dotenv";
import OpenAI from "openai";
import { z } from "zod";
import { TOOL_NAMES, toolSchemas } from "../src/server/ai/tools/schemas";

config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL, timeout: 120_000, maxRetries: 0 });
const model = process.env.OPENAI_MODEL!;

const tools = TOOL_NAMES.map((name) => {
  const json = z.toJSONSchema(toolSchemas[name], { target: "draft-7", io: "input" }) as Record<string, unknown>;
  delete json.$schema;
  return { type: "function" as const, function: { name, description: toolSchemas[name].description ?? name, parameters: json } };
});
const fakeVocab = Array.from({ length: 36 }, (_, i) => `DISTRICT${i}`).join(", ") + "\n" + Array.from({ length: 52 }, (_, i) => `PROJECT NUMBER ${i} LONG NAME`).join("; ");
const system = `You are the data assistant for an HR app. Answer only from tools. Always call a tool before stating numbers.\nKNOWN VALUES\n${fakeVocab}\nProject "PRADHAN MANTRI AWAS YOJANA" is often called PMAY.`;

for (const thinking of [true, false]) {
  const t0 = Date.now();
  try {
    const r = await client.chat.completions.create({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: "How many candidates belong to PMAY?" }],
      tools,
      tool_choice: "auto",
      temperature: 0.1,
      max_tokens: 700,
      // @ts-expect-error vendor extension
      chat_template_kwargs: { enable_thinking: thinking },
    });
    const m = r.choices[0].message;
    const rc = (m as { reasoning_content?: string }).reasoning_content;
    console.log(`thinking=${thinking}: ${Date.now() - t0} ms, finish=${r.choices[0].finish_reason}, tool=${m.tool_calls?.[0]?.type === "function" ? m.tool_calls[0].function.name + " " + m.tool_calls[0].function.arguments : "none"}, reasoning_chars=${rc?.length ?? 0}, usage=${JSON.stringify(r.usage)}`);
  } catch (e) {
    console.log(`thinking=${thinking}: FAILED after ${Date.now() - t0} ms — ${e instanceof Error ? e.message : e}`);
  }
}
