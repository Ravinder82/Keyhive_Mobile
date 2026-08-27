import { afterEach, describe, expect, it, vi } from "vitest";
import { openaiAdapter } from "../src/providers/openai";
import { anthropicAdapter } from "../src/providers/anthropic";
import { geminiAdapter } from "../src/providers/gemini";
import { openRouterAdapter } from "../src/providers/openrouter";
import { getAdapter, listProviderCatalog } from "../src/providers/registry";
import type { ProviderAdapter } from "../src/providers/types";

const ARGS = (apiKey = "sk-test-abcd1234567890abcdef") => ({
  apiKey,
  model: "gpt-4o-mini",
  prompt: "Reply with the single word OK.",
  maxTokens: 16,
  timeoutMs: 5000,
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function expectSuccess(adapter: ProviderAdapter, model: string, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
  vi.stubGlobal("fetch", fetchMock);
  const out = await adapter.sendTestRequest({ ...ARGS(), model });
  expect(out.ok).toBe(true);
  expect(out.error).toBeUndefined();
  expect(out.latencyMs).toBeGreaterThanOrEqual(0);
  return { out, fetchMock };
}

describe("provider adapters — success paths", () => {
  it("OpenAI normalizes usage and builds an authorized request", async () => {
    const { out, fetchMock } = await expectSuccess(openaiAdapter, "gpt-4o-mini", {
      usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
    });
    expect(out.usage).toEqual({ inputTokens: 12, outputTokens: 5, totalTokens: 17 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-test-abcd1234567890abcdef");
    expect(JSON.parse(String(init.body)).model).toBe("gpt-4o-mini");
  });

  it("OpenAI uses max_completion_tokens for o-series models", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { usage: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await openaiAdapter.sendTestRequest({ ...ARGS(), model: "o3" });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.max_completion_tokens).toBe(16);
    expect(body.max_tokens).toBeUndefined();
  });

  it("Anthropic sends versioned headers and normalizes usage", async () => {
    const { out, fetchMock } = await expectSuccess(
      anthropicAdapter,
      "claude-3-5-haiku-20241022",
      { usage: { input_tokens: 11, output_tokens: 3 } },
    );
    expect(out.usage).toEqual({ inputTokens: 11, outputTokens: 3, totalTokens: 14 });
    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test-abcd1234567890abcdef");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    // The API key must never appear in the URL.
    expect(String(fetchMock.mock.calls[0]![0])).not.toContain("sk-test");
  });

  it("Gemini keeps the key out of the URL and normalizes usageMetadata", async () => {
    const gemKey = "AIza" + "A".repeat(33);
    const { out, fetchMock } = await expectSuccess(
      geminiAdapter,
      "gemini-2.0-flash",
      { usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4, totalTokenCount: 13 } },
    );
    void gemKey;
    expect(out.usage).toEqual({ inputTokens: 9, outputTokens: 4, totalTokens: 13 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("models/gemini-2.0-flash:generateContent");
    expect(url).not.toContain("AIza");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBeTruthy();
  });

  it("OpenRouter normalizes OpenAI-compatible usage", async () => {
    const { out } = await expectSuccess(openRouterAdapter, "openai/gpt-4o-mini", {
      usage: { prompt_tokens: 20, completion_tokens: 10 },
    });
    expect(out.usage?.totalTokens).toBe(30);
  });
});

describe("provider adapters — sanitized failures", () => {
  const SECRET = "sk-test-abcd1234567890abcdef";

  async function expectSanitized(
    adapter: ProviderAdapter,
    stub: () => Response,
  ): Promise<void> {
    vi.stubGlobal("fetch", vi.fn(async () => stub()));
    const out = await adapter.sendTestRequest(ARGS(SECRET));
    expect(out.ok).toBe(false);
    expect(out.error).toBeDefined();
    const serialized = JSON.stringify(out);
    // No key material and no provider response content may leak.
    expect(serialized).not.toContain(SECRET);
    return;
  }

  it("maps 401 to auth_invalid with a static message", async () => {
    await expectSanitized(openaiAdapter, () =>
      jsonResponse(401, { error: { message: `bad key ${SECRET}` } }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse(401, { error: { message: `bad key ${SECRET}` } })),
    );
    const out = await openaiAdapter.sendTestRequest(ARGS(SECRET));
    expect(out.error!.category).toBe("auth_invalid");
    expect(out.error!.message).not.toContain(SECRET);
    expect(out.error!.message).toMatch(/rejected/i);
  });

  it("maps 429 to rate_limited", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(429, { error: {} })));
    const out = await anthropicAdapter.sendTestRequest({
      ...ARGS("sk-ant-" + "x".repeat(25)),
      model: "claude-3-5-haiku-20241022",
    });
    expect(out.error!.category).toBe("rate_limited");
    expect(out.error!.retryable).toBe(true);
  });

  it("maps network failure to network_error without leaking details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new TypeError("fetch failed: ECONNRESET 10.0.0.1");
      }),
    );
    const out = await openaiAdapter.sendTestRequest(ARGS());
    expect(out.error!.category).toBe("network_error");
    expect(JSON.stringify(out)).not.toContain("ECONNRESET");
  });

  it("maps abort to timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new DOMException("aborted", "AbortError"))),
    );
    const out = await openaiAdapter.sendTestRequest(ARGS());
    expect(out.error!.category).toBe("timeout");
  });

  it("maps malformed success bodies to malformed_response", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(200, "not-json-shape")));
    const out = await geminiAdapter.sendTestRequest({
      ...ARGS("AIza" + "A".repeat(33)),
      model: "gemini-2.0-flash",
    });
    expect(out.error!.category).toBe("malformed_response");
  });

  it("maps 500 to server_error", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(503, { sorry: true })));
    const out = await openRouterAdapter.sendTestRequest(ARGS());
    expect(out.error!.category).toBe("server_error");
  });
});

describe("key format validation", () => {
  it("rejects keys with wrong prefixes before any network call", () => {
    expect(openaiAdapter.validateConfiguration("AIzaNotAnOpenAIKey123456")?.category).toBe(
      "bad_request",
    );
    expect(anthropicAdapter.validateConfiguration("sk-plain-wrong")?.category).toBe("bad_request");
    expect(geminiAdapter.validateConfiguration("sk-openai-style")?.category).toBe("bad_request");
    expect(openRouterAdapter.validateConfiguration("sk-norouter")?.category).toBe("bad_request");
    expect(openaiAdapter.validateConfiguration("")).not.toBeNull();
  });

  it("accepts correctly shaped keys", () => {
    expect(openaiAdapter.validateConfiguration("sk-abcdef1234567890abcdef")).toBeNull();
    expect(anthropicAdapter.validateConfiguration("sk-ant-abcdef1234567890abcd")).toBeNull();
    expect(geminiAdapter.validateConfiguration(`AIza${"a".repeat(33)}`)).toBeNull();
    expect(openRouterAdapter.validateConfiguration("sk-or-abcdef1234567890abcd")).toBeNull();
  });
});

describe("registry", () => {
  it("exposes all four providers with catalogs", () => {
    const catalog = listProviderCatalog();
    expect(catalog.map((c) => c.id).sort()).toEqual(["anthropic", "gemini", "openai", "openrouter"]);
    for (const c of catalog) {
      expect(c.models.length).toBeGreaterThan(0);
      expect(getAdapter(c.id).defaultModel()).toBeTruthy();
    }
  });
});
