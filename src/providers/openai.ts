import type { UsageMetadata } from "../shared/types";
import { makeAdapter } from "./adapter-factory";

interface OpenAIChatBody {
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export const openaiAdapter = makeAdapter({
  id: "openai",
  displayName: "OpenAI",
  defaultModel: "gpt-4o-mini",
  models: [
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    { id: "gpt-4.1-nano", label: "GPT-4.1 nano" },
    { id: "o3", label: "o3" },
    { id: "o4-mini", label: "o4-mini" },
  ],
  keyPattern: /^sk-[A-Za-z0-9_-]{20,}$/,
  endpoint: () => "https://api.openai.com/v1/chat/completions",
  headers: (apiKey) => ({ authorization: `Bearer ${apiKey}` }),
  requestBody(model, prompt, maxTokens) {
    // Reasoning models reject `max_tokens`; everything else rejects
    // `max_completion_tokens` on older endpoints.
    if (/^o\d/.test(model)) {
      return {
        model,
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: maxTokens,
      };
    }
    return { model, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens };
  },
  normalizeUsage(body): UsageMetadata | undefined {
    const u = (body as OpenAIChatBody)?.usage;
    if (!u || typeof u !== "object") return undefined;
    const input = num(u.prompt_tokens);
    const output = num(u.completion_tokens);
    const reported = num(u.total_tokens);
    const derived =
      input !== undefined || output !== undefined ? (input ?? 0) + (output ?? 0) : undefined;
    if (reported === undefined && derived === undefined) return undefined;
    return { inputTokens: input, outputTokens: output, totalTokens: reported ?? derived };
  },
});
