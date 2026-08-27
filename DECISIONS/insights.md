# DECISIONS/insights.md

**Status:** Accepted (V1) · **Scope:** Need to Know / Needs Attention / Watch / Healthy

## Decision
Deterministic, explainable rule engine. Each rule: threshold + stable ID + explanation + supporting metrics. Priority = severity × confidence × magnitude × recency (all inputs recorded on the card). Selection: top-1 Need to Know, top-3 each of Needs Attention / Watch / Healthy, sorted by score within layer.

## Design rules
1. **Additive only.** Insights render in their own panel; raw metrics/charts/breakdowns always render alongside. No rule can suppress data.
2. **Sufficient data or silence.** Comparative rules require a non-empty previous equal-length window and minimum samples (e.g., ≥5 baseline requests). Empty windows produce zero insights — never fake trends.
3. **Stable IDs** (`rule:provider:credentialId`) enable duplicate suppression across recomputes; identical conditions always yield identical IDs (tested).
4. **Confidence** scales with sample size (`confidenceFromSample`); **recency** decays with the signal's age (half-life = window/3).
5. **Direct observations beat comparisons**: auth failures fire immediately at confidence 1.0 regardless of history.
6. **Credential lifecycle signals** (never tested / last test failed / last test passed) come from vault metadata, giving the tester and insights a closed loop.

## Alternatives considered
- **Cloud AI analysis** — explicitly excluded (privacy + non-determinism). V2+ backlog requires explicit opt-in.
- **ML anomaly detection** — opaque, untestable, data-hungry. Rejected for V1.
- **More aggressive thresholds** — tuned to fire rarely and mean something; a noisy insight panel trains users to ignore it.

## Extending
New rule ⇒ threshold + stable ID + explanation string + tests for (a) trigger, (b) below-threshold suppression, (c) ranking interaction. Update the master spec's examples if the rule becomes user-visible default.
