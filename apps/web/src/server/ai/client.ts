import "server-only";
import OpenAI from "openai";

/** Any OpenAI-compatible chat endpoint (default: NVIDIA NIM). Key and URL come from server env only. */
export function aiConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const baseURL = process.env.OPENAI_BASE_URL?.trim() || undefined;
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  return { configured: !!apiKey, baseURL, model, provider: baseURL?.includes("nvidia") ? "NVIDIA NIM" : baseURL ? "Custom" : "OpenAI" };
}

let cached: OpenAI | null = null;
export function aiClient(): OpenAI {
  const { configured, baseURL } = aiConfig();
  if (!configured) throw new Error("AI is not configured (OPENAI_API_KEY is empty).");
  return (cached ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL, timeout: 90_000, maxRetries: 0 }));
}
