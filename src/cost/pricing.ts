/**
 * Versioned model pricing registry.
 *
 * Rules (doc §17):
 *  - Prices are per 1,000,000 tokens in USD unless a `unit` override is given.
 *  - Every entry carries an effectiveFrom date and a source reference.
 *  - Pricing is list-price at the recorded effectiveFrom date; providers change
 *    prices over time and tiered/context-dependent prices exist. All computed
 *    figures are ESTIMATES, never an official provider invoice.
 *  - Unknown or stale pricing must yield "cost unavailable" — never a guess.
 */

export interface PricingEntry {
  provider: string;
  /** Model family key used for lookup (lowercase). */
  model: string;
  effectiveFrom: string; // ISO date
  inputPrice?: number; // USD per 1M tokens
  outputPrice?: number; // USD per 1M tokens
  currency: "USD";
  unit: "1M-token";
  source: string;
}

export const PRICING_VERSION = 3;

const SRC_OPENAI = "openai.com/api/pricing (list price)";
const SRC_ANTHROPIC = "anthropic.com/pricing (list price)";
const SRC_GOOGLE = "ai.google.dev/pricing (list price)";

export const PRICING_REGISTRY: PricingEntry[] = [
  // ------------------------------------------------------------- OpenAI
  {
    provider: "openai",
    model: "gpt-4o-mini",
    effectiveFrom: "2024-07-18",
    inputPrice: 0.15,
    outputPrice: 0.6,
    currency: "USD",
    unit: "1M-token",
    source: SRC_OPENAI,
  },
  {
    provider: "openai",
    model: "gpt-4o",
    effectiveFrom: "2024-08-12",
    inputPrice: 2.5,
    outputPrice: 10,
    currency: "USD",
    unit: "1M-token",
    source: SRC_OPENAI,
  },
  {
    provider: "openai",
    model: "gpt-4.1",
    effectiveFrom: "2025-04-14",
    inputPrice: 2,
    outputPrice: 8,
    currency: "USD",
    unit: "1M-token",
    source: SRC_OPENAI,
  },
  {
    provider: "openai",
    model: "gpt-4.1-mini",
    effectiveFrom: "2025-04-14",
    inputPrice: 0.4,
    outputPrice: 1.6,
    currency: "USD",
    unit: "1M-token",
    source: SRC_OPENAI,
  },
  {
    provider: "openai",
    model: "gpt-4.1-nano",
    effectiveFrom: "2025-04-14",
    inputPrice: 0.1,
    outputPrice: 0.4,
    currency: "USD",
    unit: "1M-token",
    source: SRC_OPENAI,
  },
  {
    provider: "openai",
    model: "o3",
    effectiveFrom: "2025-04-16",
    inputPrice: 2,
    outputPrice: 8,
    currency: "USD",
    unit: "1M-token",
    source: SRC_OPENAI,
  },
  {
    provider: "openai",
    model: "o4-mini",
    effectiveFrom: "2025-04-16",
    inputPrice: 1.1,
    outputPrice: 4.4,
    currency: "USD",
    unit: "1M-token",
    source: SRC_OPENAI,
  },
  {
    provider: "openai",
    model: "gpt-4-turbo",
    effectiveFrom: "2024-04-08",
    inputPrice: 10,
    outputPrice: 30,
    currency: "USD",
    unit: "1M-token",
    source: SRC_OPENAI,
  },

  // ----------------------------------------------------------- Anthropic
  {
    provider: "anthropic",
    model: "claude-3-5-haiku",
    effectiveFrom: "2024-11-04",
    inputPrice: 0.8,
    outputPrice: 4,
    currency: "USD",
    unit: "1M-token",
    source: SRC_ANTHROPIC,
  },
  {
    provider: "anthropic",
    model: "claude-3-5-sonnet",
    effectiveFrom: "2024-10-22",
    inputPrice: 3,
    outputPrice: 15,
    currency: "USD",
    unit: "1M-token",
    source: SRC_ANTHROPIC,
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-4",
    effectiveFrom: "2025-05-22",
    inputPrice: 3,
    outputPrice: 15,
    currency: "USD",
    unit: "1M-token",
    source: SRC_ANTHROPIC,
  },
  {
    provider: "anthropic",
    model: "claude-opus-4",
    effectiveFrom: "2025-05-22",
    inputPrice: 15,
    outputPrice: 75,
    currency: "USD",
    unit: "1M-token",
    source: SRC_ANTHROPIC,
  },
  {
    provider: "anthropic",
    model: "claude-3-opus",
    effectiveFrom: "2024-03-07",
    inputPrice: 15,
    outputPrice: 75,
    currency: "USD",
    unit: "1M-token",
    source: SRC_ANTHROPIC,
  },
  {
    provider: "anthropic",
    model: "claude-3-haiku",
    effectiveFrom: "2024-03-13",
    inputPrice: 0.25,
    outputPrice: 1.25,
    currency: "USD",
    unit: "1M-token",
    source: SRC_ANTHROPIC,
  },

  // -------------------------------------------------------------- Google
  {
    provider: "gemini",
    model: "gemini-2.0-flash-lite",
    effectiveFrom: "2025-02-25",
    inputPrice: 0.075,
    outputPrice: 0.3,
    currency: "USD",
    unit: "1M-token",
    source: SRC_GOOGLE,
  },
  {
    provider: "gemini",
    model: "gemini-2.0-flash",
    effectiveFrom: "2025-02-25",
    inputPrice: 0.1,
    outputPrice: 0.4,
    currency: "USD",
    unit: "1M-token",
    source: SRC_GOOGLE,
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash",
    effectiveFrom: "2025-06-17",
    inputPrice: 0.3,
    outputPrice: 2.5,
    currency: "USD",
    unit: "1M-token",
    source: SRC_GOOGLE,
  },
  {
    provider: "gemini",
    model: "gemini-2.5-pro",
    effectiveFrom: "2025-06-17",
    inputPrice: 1.25,
    outputPrice: 10,
    currency: "USD",
    unit: "1M-token",
    source: SRC_GOOGLE,
  },
  {
    provider: "gemini",
    model: "gemini-1.5-flash",
    effectiveFrom: "2024-09-24",
    inputPrice: 0.075,
    outputPrice: 0.3,
    currency: "USD",
    unit: "1M-token",
    source: SRC_GOOGLE,
  },
  {
    provider: "gemini",
    model: "gemini-1.5-pro",
    effectiveFrom: "2024-10-02",
    inputPrice: 1.25,
    outputPrice: 5,
    currency: "USD",
    unit: "1M-token",
    source: SRC_GOOGLE,
  },

  // ------------------------------------- OpenRouter (upstream list mirror)
  {
    provider: "openrouter",
    model: "openai/gpt-4o-mini",
    effectiveFrom: "2024-07-18",
    inputPrice: 0.15,
    outputPrice: 0.6,
    currency: "USD",
    unit: "1M-token",
    source: "Mirror of upstream OpenAI list price via openrouter.ai",
  },
  {
    provider: "openrouter",
    model: "anthropic/claude-3.5-haiku",
    effectiveFrom: "2024-11-04",
    inputPrice: 0.8,
    outputPrice: 4,
    currency: "USD",
    unit: "1M-token",
    source: "Mirror of upstream Anthropic list price via openrouter.ai",
  },
  {
    provider: "openrouter",
    model: "google/gemini-2.0-flash-001",
    effectiveFrom: "2025-02-25",
    inputPrice: 0.1,
    outputPrice: 0.4,
    currency: "USD",
    unit: "1M-token",
    source: "Mirror of upstream Google list price via openrouter.ai",
  },
];

/**
 * Resolves the applicable pricing entry for a concrete model id.
 * Exact match wins; otherwise the longest family-prefix match
 * (e.g. "gpt-4o-mini-2024-07-18" → "gpt-4o-mini").
 */
export function resolvePricing(provider: string, model?: string): PricingEntry | null {
  if (!model) return null;
  const norm = model.trim().toLowerCase();
  let best: PricingEntry | null = null;
  let bestLen = -1;
  for (const e of PRICING_REGISTRY) {
    if (e.provider !== provider) continue;
    const m = e.model.toLowerCase();
    if (norm === m) return e;
    // Family match: registry key followed by a separator/date suffix.
    if (
      norm.startsWith(m) &&
      m.length > bestLen &&
      (norm.length === m.length || /[^a-z0-9]/.test(norm[m.length] ?? ""))
    ) {
      best = e;
      bestLen = m.length;
    }
  }
  return best;
}
