import { describe, expect, it } from "vitest";
import { estimateCost } from "../src/cost/engine";
import { PRICING_REGISTRY, PRICING_VERSION, resolvePricing } from "../src/cost/pricing";

describe("pricing registry", () => {
  it("entries are complete and versioned", () => {
    for (const p of PRICING_REGISTRY) {
      expect(p.provider).toBeTruthy();
      expect(p.model).toBeTruthy();
      expect(p.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.currency).toBe("USD");
      expect(p.unit).toBe("1M-token");
      expect(p.source).toBeTruthy();
      expect(p.inputPrice).toBeGreaterThanOrEqual(0);
      expect(p.outputPrice).toBeGreaterThanOrEqual(0);
    }
  });

  it("resolves exact and family-prefix model ids", () => {
    expect(resolvePricing("openai", "gpt-4o-mini")?.inputPrice).toBe(0.15);
    expect(resolvePricing("openai", "gpt-4o-mini-2024-07-18")?.model).toBe("gpt-4o-mini");
    expect(resolvePricing("anthropic", "claude-3-5-sonnet-20241022")?.outputPrice).toBe(15);
    expect(resolvePricing("gemini", "gemini-2.0-flash")?.inputPrice).toBe(0.1);
    expect(resolvePricing("openrouter", "openai/gpt-4o-mini")?.source).toContain("openrouter");
  });

  it("does not match unrelated models or providers", () => {
    expect(resolvePricing("openai", "totally-unknown-model")).toBeNull();
    expect(resolvePricing("openai", "claude-3-5-haiku-20241022")).toBeNull();
    expect(resolvePricing("openai", undefined)).toBeNull();
  });
});

describe("cost engine", () => {
  it("computes input/output cost from token usage (per 1M pricing)", () => {
    const cost = estimateCost("openai", "gpt-4o-mini", {
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      totalTokens: 1_500_000,
    });
    // 1M input × $0.15 + 0.5M output × $0.60 = $0.15 + $0.30
    expect(cost!.inputCostUsd).toBeCloseTo(0.15, 6);
    expect(cost!.outputCostUsd).toBeCloseTo(0.3, 6);
    expect(cost!.totalCostUsd).toBeCloseTo(0.45, 6);
    expect(cost!.pricingVersion).toBe(PRICING_VERSION);
    expect(cost!.currency).toBe("USD");
  });

  it("handles tiny requests with sub-cent precision", () => {
    const cost = estimateCost("openai", "gpt-4o-mini", { inputTokens: 100, outputTokens: 50 });
    expect(cost!.totalCostUsd).toBeCloseTo(100 / 1e6 * 0.15 + 50 / 1e6 * 0.6, 9);
  });

  it("returns undefined for unknown models — never fabricates", () => {
    expect(
      estimateCost("openai", "gpt-99-fantasy", { inputTokens: 10, outputTokens: 10 }),
    ).toBeUndefined();
  });

  it("returns undefined when usage is missing or total-only", () => {
    expect(estimateCost("openai", "gpt-4o-mini", undefined)).toBeUndefined();
    expect(estimateCost("openai", "gpt-4o-mini", { totalTokens: 100 })).toBeUndefined();
  });

  it("is reproducible: same usage + pricing version ⇒ same estimate", () => {
    const usage = { inputTokens: 1234, outputTokens: 567 };
    const a = estimateCost("anthropic", "claude-3-5-haiku-20241022", usage);
    const b = estimateCost("anthropic", "claude-3-5-haiku-20241022", usage);
    expect(a).toEqual(b);
  });
});
