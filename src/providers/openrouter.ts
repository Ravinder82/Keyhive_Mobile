import type { UsageMetadata } from "../shared/types";
import { makeAdapter } from "./adapter-factory";

interface OpenRouterBody {
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export const openRouterAdapter = makeAdapter({
  id: "openrouter",
  displayName: "OpenRouter",
  defaultModel: "openai/gpt-4o-mini",
  models: [
    { id: "openai/gpt-4o-mini", label: "GPT-4o mini (via OpenRouter)" },
    { id: "anthropic/claude-3.5-haiku", label: "Claude 3.5 Haiku (via OpenRouter)" },
    { id: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash (via OpenRouter)" },
    { id: "meta-llama/llama-3.1-8b-instruct", label: "Llama 3.1 8B (via OpenRouter)" },
    { id: "deepseek/deepseek-chat", label: "DeepSeek Chat (via OpenRouter)" },
  ],
  keyPattern: /^sk-or-[A-Za-z0-9_-]{20,}$/,
  endpoint: () => "https://openrouter.ai/api/v1/chat/completions",
  headers: (apiKey) => ({ authorization: `Bearer ${apiKey}` }),
  requestBody(model, prompt, maxTokens) {
    return {
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
    };
  },
  normalizeUsage(body): UsageMetadata | undefined {
    const u = (body as OpenRouterBody)?.usage;
    if (!u || typeof u !== "object") return undefined;
    const input = num(u.prompt_tokens);
    const output = num(u.completion_tokens);
    const total = num(u.total_tokens);
    if (input === undefined && output === undefined && total === undefined) return undefined;
    return {
      inputTokens: input,
      outputTokens: output,
      totalTokens: total ?? (input ?? 0) + (output ?? 0),
    };
  },
});
