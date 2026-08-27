# DECISIONS/cost-engine.md

**Status:** Accepted (V1) · **Scope:** pricing registry & estimates

## Decision
Versioned registry (`PRICING_VERSION`) of list prices per 1M tokens (USD) with mandatory `provider`, `model`, `effectiveFrom`, `currency`, `unit`, `source` fields. Cost = input/1e6×inputPrice + output/1e6×outputPrice, stamped onto the usage event at request time together with the pricing version.

## Honesty rules (non-negotiable)
1. **Unknown pricing ⇒ no number.** `estimateCost` returns `undefined`; UI renders "Cost unavailable". Never fabricate, never default to zero, never guess ratios.
2. **Total-only usage ⇒ no number.** If the provider reports only a combined token count, we cannot split input/output honestly — we refuse rather than assume a blend.
3. **Estimates, not invoices.** All UI labels say "estimate". No claim of official billing.
4. **History is immutable.** Events keep the pricing version used at request time; later registry edits never rewrite historical estimates (reproducibility tested).
5. **Model resolution** is exact-match first, then longest family-prefix with a separator boundary (`gpt-4o-mini-2024-07-18` → `gpt-4o-mini`).

## Registry maintenance
Entries record list prices at their effective dates with source references (official pricing pages; OpenRouter entries are labeled as upstream mirrors). Providers change prices and add context-tiered pricing — before each release, verify entries against official pages and bump `PRICING_VERSION` on change. Stale entries are safer than invented ones: a stale entry slightly misestimates; a fabricated one lies.

## Alternatives considered
- **Provider billing APIs** — out of scope for V1 (master spec §2/§30) except where separately approved later.
- **OpenRouter's in-response cost field** — authoritative-ish but inconsistent with the rest of the pipeline; deferred to V2 consideration.
- **Live price fetch at runtime** — creates network dependency and trust issues for the exact numbers users budget on; rejected for V1.
