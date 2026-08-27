# DECISIONS/analytics.md

**Status:** Accepted (V1) · **Scope:** usage events, storage, aggregation

## Decision
- Schema v1 per master spec §16, plus `httpStatus`, `pricingVersion` and `testKind` for reproducibility and provenance.
- One completed provider request ⇒ exactly one event. V1 models no retries.
- Storage: single-key ring buffer in `chrome.storage.local`, cap 5,000, prune-oldest.
- Aggregation: pure functions (`summarize`, `buildSeries`, `breakdown`) computed per snapshot fetch. Bucket width adapts to range (24h→hourly, 7d/30d→daily, all→weekly).
- Honesty rules: token/cost sums are `null` (not 0) when never reported; `costAvailable:false` marks events whose pricing was unknown.

## Alternatives considered
- **SQLite/WASM** — unjustified at ≤5k tiny events; adds heavy dependency.
- **Per-day aggregate buckets updated incrementally** — faster at huge volumes but loses per-event auditability and complicates schema changes; O(n) over 5k events is <5 ms.
- **Storing prompt/completion previews** — forbidden by spec §3/§16; never considered seriously.

## Retention & deletion
Cap enforces bounded growth. "Clear analytics" deletes the store; "Delete all data" wipes storage.local/session entirely. No export in V1 (no plaintext egress paths).
