import type { ModelInfo, UsageMetadata } from "../shared/types";
import { makeAdapter } from "./adapter-factory";
import { fetchJson, readJsonBody } from "./http";

interface GeminiBody {
  usageMetadata?: {
    promptTokenCount?: unknown;
    candidatesTokenCount?: unknown;
    totalTokenCount?: unknown;
  };
}
interface GeminiModelsResponse {
  models?: Array<{ name: string; displayName?: string }>;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

async function fetchGeminiModels(apiKey: string): Promise<ModelInfo[]> {
  try {
    const res = await fetchJson(
      "https://generativelanguage.googleapis.com/v1beta/models",
      {
        headers: { "x-goog-api-key": apiKey },
      },
      10000,
    );
    if (!res.ok) return [];
    const body = await readJsonBody(res) as GeminiModelsResponse;
    if (!body?.models || !Array.isArray(body.models)) return [];
    return body.models
      .filter((item) => item.name && item.name.startsWith("models/"))
      .map((item) => ({
        id: item.name.replace("models/", ""),
        label: item.displayName || item.name.replace("models/", ""),
      }));
  } catch {
    return [];
  }
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
  fetchModels: fetchGeminiModels,
});