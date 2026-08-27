import type { UsageMetadata } from "../shared/types";
import { makeAdapter } from "./adapter-factory";

interface AnthropicBody {
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export const anthropicAdapter = makeAdapter({
  id: "anthropic",
  displayName: "Anthropic",
  defaultModel: "claude-3-5-haiku-20241022",
  models: [
    { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
    { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
    { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { id: "claude-opus-4-20250514", label: "Claude Opus 4" },
    { id: "claude-3-opus-latest", label: "Claude 3 Opus" },
  ],
  keyPattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
  endpoint: () => "https://api.anthropic.com/v1/messages",
  headers: (apiKey) => ({
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    // Required when calling Anthropic directly from a browser extension context.
    "anthropic-dangerous-direct-browser-access": "true",
  }),
  requestBody(model, prompt, maxTokens) {
    return {
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    };
  },
  normalizeUsage(body): UsageMetadata | undefined {
    const u = (body as AnthropicBody)?.usage;
    if (!u || typeof u !== "object") return undefined;
    const input = num(u.input_tokens);
    const output = num(u.output_tokens);
    if (input === undefined && output === undefined) return undefined;
    return {
      inputTokens: input,
      outputTokens: output,
      totalTokens:
        input !== undefined || output !== undefined ? (input ?? 0) + (output ?? 0) : undefined,
    };
  },
});
