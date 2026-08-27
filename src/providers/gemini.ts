import type { UsageMetadata } from "../shared/types";
import { makeAdapter } from "./adapter-factory";

interface GeminiBody {
  usageMetadata?: {
    promptTokenCount?: unknown;
    candidatesTokenCount?: unknown;
    totalTokenCount?: unknown;
  };
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function geminiEndpoint(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent`;
}

export const geminiAdapter = makeAdapter({
  id: "gemini",
  displayName: "Google Gemini",
  defaultModel: "gemini-2.0-flash",
  models: [
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
    { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
  ],
  keyPattern: /^AIza[0-9A-Za-z_-]{30,}$/,
  endpoint: (model) => geminiEndpoint(model),
  // Key is sent via header, never in the URL, so it cannot end up in logs.
  headers: (apiKey) => ({ "x-goog-api-key": apiKey }),
  requestBody(model, prompt, maxTokens) {
    void model;
    return {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0 },
    };
  },
  normalizeUsage(body): UsageMetadata | undefined {
    const u = (body as GeminiBody)?.usageMetadata;
    if (!u || typeof u !== "object") return undefined;
    const input = num(u.promptTokenCount);
    const output = num(u.candidatesTokenCount);
    const total = num(u.totalTokenCount);
    if (input === undefined && output === undefined && total === undefined) return undefined;
    return {
      inputTokens: input,
      outputTokens: output,
      totalTokens: total ?? (input ?? 0) + (output ?? 0),
    };
  },
});
