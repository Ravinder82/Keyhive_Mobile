/**
 * Cost engine: converts token usage + registry pricing into estimates.
 * Returns undefined when no applicable pricing exists — callers must render
 * "cost unavailable" rather than fabricate a number (doc §17).
 */

import type { CostEstimate, UsageMetadata } from "../shared/types";
import { PRICING_VERSION, resolvePricing } from "./pricing";

export function estimateCost(
  provider: string,
  model: string | undefined,
  usage: UsageMetadata | undefined,
): CostEstimate | undefined {
  if (!usage || !model) return undefined;
  const entry = resolvePricing(provider, model);
  if (!entry) return undefined;
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  // If the adapter only reported a total, we cannot split it honestly —
  // refuse rather than assume a ratio.
  if (
    usage.inputTokens === undefined &&
    usage.outputTokens === undefined &&
    usage.totalTokens !== undefined
  ) {
    return undefined;
  }
  const inPrice = entry.inputPrice ?? 0;
  const outPrice = entry.outputPrice ?? 0;
  const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
  const inputCostUsd = round6((input / 1_000_000) * inPrice);
  const outputCostUsd = round6((output / 1_000_000) * outPrice);
  return {
    inputCostUsd,
    outputCostUsd,
    totalCostUsd: round6(inputCostUsd + outputCostUsd),
    currency: "USD",
    pricingVersion: PRICING_VERSION,
  };
}
