import type { ModelInfo, UsageMetadata } from "../shared/types";
import { makeAdapter } from "./adapter-factory";
import { fetchJson, readJsonBody } from "./http";

interface AnthropicBody {
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
}
interface AnthropicModelsResponse {
  data?: Array<{ id: string; display_name?: string }>;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

async function fetchAnthropicModels(apiKey: string): Promise<ModelInfo[]> {
  try {
    const res = await fetchJson(
      "https://api.anthropic.com/v1/models",
      {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
      },
      10000,
    );
    if (!res.ok) return [];
    const body = await readJsonBody(res) as AnthropicModelsResponse;
    if (!body?.data || !Array.isArray(body.data)) return [];
    return body.data.map((item) => ({
      id: item.id,
      label: item.display_name || item.id,
    }));
  } catch {
    return [];
  }
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
  fetchModels: fetchAnthropicModels,
});
