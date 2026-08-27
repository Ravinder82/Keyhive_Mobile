/**
 * Insight engine (doc §12–15): deterministic, explainable rules across the
 * four layers — Need to Know, Needs Attention, Watch, Healthy.
 *
 * Guarantees:
 *  - Rules fire only with sufficient data; no fabricated trends.
 *  - Stable insight ids act as dedupe keys for downstream persistence/UI
 *    keying; identical conditions always produce identical ids.
 *  - Insights are additive: they never remove or replace raw analytics.
 */

import type {
  CredentialMeta,
  Insight,
  InsightLayer,
  InsightScope,
  RangeKey,
  UsageEvent,
} from "../shared/types";
import { rangeMillis } from "../shared/types";
import { summarize } from "../analytics/aggregate";
import { confidenceFromSample, finalize, recencyOf, ScoreableInsight } from "./scoring";

export interface InsightInput {
  range: RangeKey;
  current: UsageEvent[];
  previous: UsageEvent[];
  now: number;
  scopeLabel: string; // "All credentials" or a credential label
  credential?: CredentialMeta;
  scope: InsightScope;
}

export function generateInsights(input: InsightInput): Insight[] {
  const span = rangeMillis(input.range) ?? 0;
  const cur = summarize(input.current);
  const prev = input.previous.length > 0 ? summarize(input.previous) : null;
  const base: Pick<Insight, "windowLabel" | "generatedAt" | "scope"> = {
    windowLabel: labelFor(input.range),
    generatedAt: input.now,
    scope: input.scope,
  };
  const cands: ScoreableInsight[] = [];

  const lastEventAt = input.current.length
    ? Math.max(...input.current.map((e) => e.timestamp))
    : null;
  const recency = (ts: number) => (span ? recencyOf(ts, span, input.now) : 1);

  // ------------------------------------------------------------ Need to Know
  if (prev && prev.estimatedCostUsd !== null && cur.estimatedCostUsd !== null) {
    const delta = cur.estimatedCostUsd - prev.estimatedCostUsd;
    const ratio = prev.estimatedCostUsd > 0 ? delta / prev.estimatedCostUsd : Infinity;
    if (ratio >= 0.25 && delta >= 0.05 && prev.requests >= 5) {
      const pct = Math.round(ratio * 100);
      cands.push({
        id: stableId("ntk-cost-spike", input.scope),
        layer: "need_to_know",
        title: `Estimated spend ${pct}% above the previous ${labelFor(input.range)} for ${input.scopeLabel}`,
        detail:
          `Estimated spend of the most recent ${labelFor(input.range)} is compared against the ` +
          `immediately preceding equal-length period. This fired because growth reached at least 25% and $0.05.`,
        metrics: [
          { label: "Current spend", value: `$${cur.estimatedCostUsd.toFixed(4)}` },
          { label: "Previous spend", value: `$${prev.estimatedCostUsd.toFixed(4)}`, compare: "+$".concat(delta.toFixed(4)) },
        ],
        severity: 4,
        confidence: confidenceFromSample(cur.requests, prev.requests),
        magnitude: ratio,
        recency: lastEventAt ? recency(lastEventAt) : 1,
        ...base,
      });
    }
  }
  if (
    prev &&
    prev.requests >= 5 &&
    cur.requests > 0 &&
    cur.failures / cur.requests - prev.failures / prev.requests >= 0.1 &&
    cur.failures / cur.requests >= 0.15
  ) {
    cands.push({
      id: stableId("ntk-failure-spike", input.scope),
      layer: "need_to_know",
      title: `Failure rate jumped for ${input.scopeLabel}`,
      detail:
        `The failure rate in the latest ${labelFor(input.range)} rose by more than 10 percentage points ` +
        `compared with the preceding equal-length period.`,
      metrics: [
        { label: "Failure rate", value: `${Math.round((cur.failures / cur.requests) * 100)}%` },
        {
          label: "Previous",
          value: `${Math.round((prev.failures / prev.requests) * 100)}%`,
          compare: `${cur.failures} of ${cur.requests} failed`,
        },
      ],
      severity: 5,
      confidence: confidenceFromSample(cur.requests, prev.requests),
      magnitude: cur.failures / Math.max(1, cur.requests),
      recency: lastEventAt ? recency(lastEventAt) : 1,
      ...base,
    });
  }

  // --------------------------------------------------------- Needs Attention
  const authFails = input.current.filter((e) => e.errorCategory === "auth_invalid");
  if (authFails.length > 0) {
    cands.push({
      id: stableId("attention-auth", input.scope),
      layer: "needs_attention",
      title:
        `${authFails.length} authentication failure${authFails.length === 1 ? "" : "s"} in ${labelFor(input.range)} (${input.scopeLabel})`,
      detail:
        "Requests were rejected as unauthorized. The stored key is likely invalid, revoked or mis-scoped. " +
        "Open the API tester and re-test this credential.",
      metrics: [{ label: "Auth failures", value: String(authFails.length) }],
      severity: 5,
      confidence: 1,
      magnitude: authFails.length / Math.max(1, cur.requests),
      recency: recency(Math.max(...authFails.map((e) => e.timestamp))),
      ...base,
    });
  }
  const quotaHits = input.current.filter(
    (e) => e.errorCategory === "quota_exceeded" || e.errorCategory === "rate_limited",
  );
  if (quotaHits.length >= 2) {
    cands.push({
      id: stableId("attention-quota", input.scope),
      layer: "needs_attention",
      title: `Rate/quota limits hit ${quotaHits.length}× for ${input.scopeLabel}`,
      detail:
        "Multiple requests were throttled or rejected by the provider within this window. " +
        "Reduce request frequency or review account limits.",
      metrics: [{ label: "Throttled requests", value: String(quotaHits.length) }],
      severity: 3,
      confidence: 1,
      magnitude: quotaHits.length / Math.max(1, cur.requests),
      recency: recency(Math.max(...quotaHits.map((e) => e.timestamp))),
      ...base,
    });
  }
  const timeouts = input.current.filter((e) => e.errorCategory === "timeout");
  if (timeouts.length >= 2) {
    cands.push({
      id: stableId("attention-timeouts", input.scope),
      layer: "needs_attention",
      title: `Timeout spike for ${input.scopeLabel}`,
      detail:
        "Two or more requests timed out in this window. The provider may be degraded or the " +
        "network unreliable — re-test the credential to confirm.",
      metrics: [{ label: "Timed-out requests", value: String(timeouts.length) }],
      severity: 3,
      confidence: 1,
      magnitude: timeouts.length / Math.max(1, cur.requests),
      recency: recency(Math.max(...timeouts.map((e) => e.timestamp))),
      ...base,
    });
  }
  const unavailable = input.current.filter((e) => e.errorCategory === "not_found");
  if (unavailable.length > 0) {
    const models = [...new Set(unavailable.map((e) => e.model).filter(Boolean))] as string[];
    cands.push({
      id: stableId("attention-model-unavailable", input.scope),
      layer: "needs_attention",
      title: `Model unavailable for ${input.scopeLabel}`,
      detail:
        "The provider reported the requested model or endpoint as not found. The model may have " +
        "been retired or the identifier is wrong — pick a current model in the tester.",
      metrics: [
        { label: "Not-found responses", value: String(unavailable.length) },
        { label: "Models", value: models.join(", ") || "—" },
      ],
      severity: 4,
      confidence: 1,
      magnitude: unavailable.length / Math.max(1, cur.requests),
      recency: recency(Math.max(...unavailable.map((e) => e.timestamp))),
      ...base,
    });
  }
  const serverErrors = input.current.filter((e) => e.errorCategory === "server_error");
  if (serverErrors.length >= 3) {
    cands.push({
      id: stableId("attention-provider-failures", input.scope),
      layer: "needs_attention",
      title: `Provider failures for ${input.scopeLabel}`,
      detail:
        "Three or more requests failed with server-side errors in this window — the provider, " +
        "not your credential, is likely at fault. Retry later and watch the failure trend.",
      metrics: [{ label: "Server errors", value: String(serverErrors.length) }],
      severity: 3,
      confidence: 1,
      magnitude: serverErrors.length / Math.max(1, cur.requests),
      recency: recency(Math.max(...serverErrors.map((e) => e.timestamp))),
      ...base,
    });
  }
  if (cur.requests >= 5 && cur.successRate !== null && cur.successRate < 0.8) {
    cands.push({
      id: stableId("attention-failures", input.scope),
      layer: "needs_attention",
      title: `High failure rate for ${input.scopeLabel}`,
      detail:
        `More than 20% of requests failed in this window. Inspect recent activity below for the dominant error category.`,
      metrics: [
        { label: "Failures", value: `${cur.failures} of ${cur.requests}` },
        { label: "Success rate", value: `${Math.round(cur.successRate * 100)}%` },
      ],
      severity: 4,
      confidence: 1,
      magnitude: 1 - cur.successRate,
      recency: lastEventAt ? recency(lastEventAt) : 1,
      ...base,
    });
  }
  if (
    prev &&
    prev.avgLatencyMs !== null &&
    cur.avgLatencyMs !== null &&
    cur.avgLatencyMs >= 1500 &&
    cur.avgLatencyMs >= prev.avgLatencyMs * 2
  ) {
    cands.push({
      id: stableId("attention-latency", input.scope),
      layer: "needs_attention",
      title: `Latency doubled vs baseline for ${input.scopeLabel}`,
      detail:
        "Average latency in this window is at least twice the previous comparable window and above 1.5 s.",
      metrics: [
        { label: "Avg latency", value: `${cur.avgLatencyMs} ms` },
        { label: "Previous", value: `${prev.avgLatencyMs} ms` },
      ],
      severity: 3,
      confidence: confidenceFromSample(cur.requests, prev.requests),
      magnitude: (cur.avgLatencyMs - prev.avgLatencyMs) / prev.avgLatencyMs,
      recency: lastEventAt ? recency(lastEventAt) : 1,
      ...base,
    });
  }
  if (input.credential) {
    const c = input.credential;
    if (!c.lastTestedAt) {
      cands.push({
        id: stableId("attention-untested", { credentialId: c.id }),
        layer: "needs_attention",
        title: `"${c.label}" has never been tested`,
        detail: "Run the API tester once to verify this credential actually works.",
        metrics: [{ label: "Status", value: "Unverified" }],
        severity: 2,
        confidence: 1,
        magnitude: 0.25,
        recency: 1,
        windowLabel: "since added",
        scope: { credentialId: c.id },
        generatedAt: input.now,
      });
    } else if (c.lastTestStatus === "failure") {
      cands.push({
        id: stableId("attention-lasttest", { credentialId: c.id }),
        layer: "needs_attention",
        title: `Last test of "${c.label}" failed`,
        detail: "The most recent explicit API test did not succeed. Re-run the tester after checking the key.",
        metrics: [{ label: "Last tested", value: new Date(c.lastTestedAt).toLocaleString() }],
        severity: 4,
        confidence: 1,
        magnitude: 0.6,
        recency: recencyOf(c.lastTestedAt, 7 * 86_400_000, input.now),
        windowLabel: "last test",
        scope: { credentialId: c.id },
        generatedAt: input.now,
      });
    }
  }

  // ------------------------------------------------------------------- Watch
  if (
    prev &&
    prev.requests >= 5 &&
    cur.requests >= prev.requests * 1.25
  ) {
    const pct = Math.round(((cur.requests - prev.requests) / prev.requests) * 100);
    cands.push({
      id: stableId("watch-usage-up", input.scope),
      layer: "watch",
      title: `Usage up ${pct}% for ${input.scopeLabel}`,
      detail:
        `Request volume grew at least 25% versus the preceding equal-length period. Not a problem by itself — watch cost alongside it.`,
      metrics: [
        { label: "Requests", value: String(cur.requests), compare: `was ${prev.requests}` },
      ],
      severity: 2,
      confidence: confidenceFromSample(cur.requests, prev.requests),
      magnitude: (cur.requests - prev.requests) / prev.requests,
      recency: lastEventAt ? recency(lastEventAt) : 1,
      ...base,
    });
  }
  if (
    prev &&
    prev.avgLatencyMs !== null &&
    cur.avgLatencyMs !== null &&
    cur.avgLatencyMs >= prev.avgLatencyMs * 1.15 &&
    cur.avgLatencyMs >= 500
  ) {
    const pct = Math.round(((cur.avgLatencyMs - prev.avgLatencyMs) / prev.avgLatencyMs) * 100);
    cands.push({
      id: stableId("watch-latency-up", input.scope),
      layer: "watch",
      title: `Average latency increased ${pct}% for ${input.scopeLabel}`,
      detail: "Average latency rose ≥15% versus the previous comparable window.",
      metrics: [
        { label: "Avg latency", value: `${cur.avgLatencyMs} ms`, compare: `was ${prev.avgLatencyMs} ms` },
      ],
      severity: 2,
      confidence: confidenceFromSample(cur.requests, prev.requests),
      magnitude: (cur.avgLatencyMs - prev.avgLatencyMs) / prev.avgLatencyMs,
      recency: lastEventAt ? recency(lastEventAt) : 1,
      ...base,
    });
  }
  if (
    prev &&
    prev.totalTokens !== null &&
    cur.totalTokens !== null &&
    cur.totalTokens >= prev.totalTokens * 1.3
  ) {
    const pct = Math.round(((cur.totalTokens - prev.totalTokens) / prev.totalTokens) * 100);
    cands.push({
      id: stableId("watch-token-growth", input.scope),
      layer: "watch",
      title: `Token usage up ${pct}% for ${input.scopeLabel}`,
      detail: "Reported token consumption grew ≥30% versus the preceding window; check whether larger prompts/models are in use.",
      metrics: [
        { label: "Tokens", value: cur.totalTokens.toLocaleString(), compare: `was ${prev.totalTokens.toLocaleString()}` },
      ],
      severity: 2,
      confidence: confidenceFromSample(cur.requests, prev.requests),
      magnitude: (cur.totalTokens - prev.totalTokens) / prev.totalTokens,
      recency: lastEventAt ? recency(lastEventAt) : 1,
      ...base,
    });
  }
  if (
    prev &&
    prev.estimatedCostUsd !== null &&
    cur.estimatedCostUsd !== null &&
    prev.estimatedCostUsd > 0 &&
    cur.estimatedCostUsd >= prev.estimatedCostUsd * 1.15 &&
    cur.estimatedCostUsd - prev.estimatedCostUsd >= 0.02 &&
    prev.requests >= 5
  ) {
    const pct = Math.round(((cur.estimatedCostUsd - prev.estimatedCostUsd) / prev.estimatedCostUsd) * 100);
    cands.push({
      id: stableId("watch-cost-up", input.scope),
      layer: "watch",
      title: `Estimated spend up ${pct}% for ${input.scopeLabel}`,
      detail:
        "Estimated spend grew ≥15% (and ≥$0.02) versus the preceding equal-length window — below the " +
        "Need-to-Know threshold but worth watching alongside usage.",
      metrics: [
        { label: "Current spend", value: `$${cur.estimatedCostUsd.toFixed(4)}`, compare: `was $${prev.estimatedCostUsd.toFixed(4)}` },
      ],
      severity: 2,
      confidence: confidenceFromSample(cur.requests, prev.requests),
      magnitude: (cur.estimatedCostUsd - prev.estimatedCostUsd) / prev.estimatedCostUsd,
      recency: lastEventAt ? recency(lastEventAt) : 1,
      ...base,
    });
  }
  const providerCounts = new Map<string, number>();
  for (const e of input.current) providerCounts.set(e.provider, (providerCounts.get(e.provider) ?? 0) + 1);
  const prevProviders = new Set(input.previous.map((e) => e.provider));
  const topProvider = [...providerCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (
    topProvider &&
    cur.requests >= 10 &&
    providerCounts.size >= 2 &&
    topProvider[1] / cur.requests >= 0.9 &&
    (providerCounts.size > 1 ? prevProviders.size === 0 || prevProviders.size > 1 : false)
  ) {
    const pct = Math.round((topProvider[1] / cur.requests) * 100);
    cands.push({
      id: stableId("watch-provider-concentration", input.scope),
      layer: "watch",
      title: `${pct}% of traffic on one provider (${topProvider[0]})`,
      detail:
        "A single provider now carries ≥90% of this window's requests while multiple providers were " +
        "previously in use. Concentration increases outage and price-change exposure — informational only.",
      metrics: [
        { label: topProvider[0], value: `${topProvider[1]} of ${cur.requests} requests` },
        { label: "Providers active", value: String(providerCounts.size) },
      ],
      severity: 1,
      confidence: 1,
      magnitude: topProvider[1] / cur.requests,
      recency: lastEventAt ? recency(lastEventAt) : 1,
      ...base,
    });
  }
  const softErrors = input.current.filter(
    (e) =>
      e.status === "failure" &&
      e.errorCategory !== undefined &&
      !["auth_invalid", "rate_limited", "quota_exceeded"].includes(e.errorCategory),
  );
  if (softErrors.length >= 3) {
    const top = modeCount(softErrors.map((e) => e.errorCategory!));
    cands.push({
      id: stableId("watch-repeat-errors", input.scope),
      layer: "watch",
      title: `Repeated "${top.key}" errors for ${input.scopeLabel}`,
      detail: "The same non-critical error category occurred three or more times in this window.",
      metrics: [{ label: "Occurrences", value: String(top.count) }],
      severity: 2,
      confidence: 1,
      magnitude: top.count / Math.max(1, cur.requests),
      recency: recency(Math.max(...softErrors.map((e) => e.timestamp))),
      ...base,
    });
  }

  // ------------------------------------------------------------------ Healthy
  if (cur.requests >= 10 && cur.successRate !== null && cur.successRate >= 0.99) {
    cands.push({
      id: stableId("healthy-success-rate", input.scope),
      layer: "healthy",
      title: `${Math.round(cur.successRate * 100)}% success rate for ${input.scopeLabel}`,
      detail: `At least 10 requests in this window succeeded almost universally.`,
      metrics: [
        { label: "Successes", value: `${cur.successes} of ${cur.requests}` },
        { label: "Avg latency", value: cur.avgLatencyMs !== null ? `${cur.avgLatencyMs} ms` : "—" },
      ],
      severity: 2,
      confidence: 1,
      magnitude: 0.3,
      recency: lastEventAt ? recency(lastEventAt) : 1,
      ...base,
    });
  }
  if (cur.requests >= 10 && authFails.length === 0) {
    cands.push({
      id: stableId("healthy-no-auth-failures", input.scope),
      layer: "healthy",
      title: `No authentication failures for ${input.scopeLabel}`,
      detail: "Ten or more requests in this window completed without a single authorization rejection — stored keys are healthy.",
      metrics: [{ label: "Requests", value: String(cur.requests) }, { label: "Auth failures", value: "0" }],
      severity: 1,
      confidence: 1,
      magnitude: 0.2,
      recency: lastEventAt ? recency(lastEventAt) : 1,
      ...base,
    });
  }
  if (
    prev &&
    prev.estimatedCostUsd !== null &&
    cur.estimatedCostUsd !== null &&
    prev.estimatedCostUsd > 0 &&
    cur.estimatedCostUsd <= prev.estimatedCostUsd * 0.85 &&
    cur.requests >= 5
  ) {
    const pct = Math.round(((prev.estimatedCostUsd - cur.estimatedCostUsd) / prev.estimatedCostUsd) * 100);
    cands.push({
      id: stableId("healthy-cost-down", input.scope),
      layer: "healthy",
      title: `Estimated spend down ${pct}% for ${input.scopeLabel}`,
      detail: "Estimated spend fell ≥15% versus the previous comparable window with meaningful traffic in both.",
      metrics: [
        { label: "Current spend", value: `$${cur.estimatedCostUsd.toFixed(4)}`, compare: `was $${prev.estimatedCostUsd.toFixed(4)}` },
      ],
      severity: 1,
      confidence: confidenceFromSample(cur.requests, prev.requests),
      magnitude: (prev.estimatedCostUsd - cur.estimatedCostUsd) / prev.estimatedCostUsd,
      recency: lastEventAt ? recency(lastEventAt) : 1,
      ...base,
    });
  }
  if (
    prev &&
    prev.avgLatencyMs !== null &&
    cur.avgLatencyMs !== null &&
    cur.avgLatencyMs <= prev.avgLatencyMs * 0.85 &&
    cur.requests >= 5
  ) {
    const pct = Math.round(((prev.avgLatencyMs - cur.avgLatencyMs) / prev.avgLatencyMs) * 100);
    cands.push({
      id: stableId("healthy-latency-down", input.scope),
      layer: "healthy",
      title: `Latency improved ${pct}% for ${input.scopeLabel}`,
      detail: "Average latency dropped ≥15% versus the previous comparable window.",
      metrics: [
        { label: "Avg latency", value: `${cur.avgLatencyMs} ms`, compare: `was ${prev.avgLatencyMs} ms` },
      ],
      severity: 2,
      confidence: confidenceFromSample(cur.requests, prev.requests),
      magnitude: (prev.avgLatencyMs - cur.avgLatencyMs) / prev.avgLatencyMs,
      recency: lastEventAt ? recency(lastEventAt) : 1,
      ...base,
    });
  }
  if (input.credential?.lastTestStatus === "success" && input.credential.lastTestedAt) {
    cands.push({
      id: stableId("healthy-test-pass", { credentialId: input.credential.id }),
      layer: "healthy",
      title: `"${input.credential.label}" passed its last API test`,
      detail: "The most recent explicit API test completed successfully.",
      metrics: [
        { label: "Last tested", value: new Date(input.credential.lastTestedAt).toLocaleString() },
      ],
      severity: 1,
      confidence: 1,
      magnitude: 0.2,
      recency: recencyOf(input.credential.lastTestedAt, 7 * 86_400_000, input.now),
      windowLabel: "last test",
      scope: { credentialId: input.credential.id },
      generatedAt: input.now,
    });
  }

  // ---------------------------------------------- select, dedupe, rank, cap
  const scored = finalize(cands);
  const needToKnow = scored
    .filter((i) => i.layer === ("need_to_know" satisfies InsightLayer))
    .sort((a, b) => b.score - a.score)
    .slice(0, 1);
  const attention = topN(scored, "needs_attention", 3);
  const watch = topN(scored, "watch", 3);
  const healthy = topN(scored, "healthy", 3);
  return [...needToKnow, ...attention, ...watch, ...healthy];
}

function topN(list: Insight[], layer: InsightLayer, n: number): Insight[] {
  return list.filter((i) => i.layer === layer).sort((a, b) => b.score - a.score).slice(0, n);
}

/** Watch/Healthy insights repeated within this window are suppressed. */
export const SUPPRESSION_WINDOW_MS = 24 * 3_600_000;
const SEEN_PRUNE_MS = 7 * 86_400_000;

/**
 * Deterministic duplicate suppression for low-severity layers: a Watch or
 * Healthy insight whose stable id was already shown within the suppression
 * window is dropped. Need to Know and Needs Attention are NEVER suppressed —
 * important signals always surface. Pure function: callers persist `seen`.
 */
export function applyRepeatSuppression(
  insights: Insight[],
  seen: Record<string, number>,
  now: number,
): { insights: Insight[]; seen: Record<string, number> } {
  const nextSeen: Record<string, number> = {};
  for (const [id, ts] of Object.entries(seen)) {
    if (typeof ts === "number" && now - ts < SEEN_PRUNE_MS) nextSeen[id] = ts;
  }
  const out = insights.filter((i) => {
    if (i.layer !== "watch" && i.layer !== "healthy") return true;
    const last = nextSeen[i.id];
    return last === undefined || now - last >= SUPPRESSION_WINDOW_MS;
  });
  // Stamp ONLY insights actually emitted: refreshing suppressed ones would
  // slide their window forward forever and they would never resurface.
  for (const i of out) nextSeen[i.id] = now;
  return { insights: out, seen: nextSeen };
}

function stableId(rule: string, scope: { credentialId?: string; provider?: string }): string {
  return [rule, scope.provider ?? "*", scope.credentialId ?? "*"].join(":");
}

function modeCount(values: string[]): { key: string; count: number } {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  let key = "";
  let count = 0;
  for (const [k, c] of m) {
    if (c > count) {
      key = k;
      count = c;
    }
  }
  return { key, count };
}

function labelFor(range: RangeKey): string {
  switch (range) {
    case "24h":
      return "24 hours";
    case "7d":
      return "7 days";
    case "30d":
      return "30 days";
    case "all":
      return "history";
  }
}
