/**
 * Aggregation: events → summaries, time series and breakdowns.
 * Pure functions over UsageEvent[] so results are fully testable and
 * reproducible. The dashboard never recomputes more than once per snapshot.
 */

import type {
  BreakdownEntry,
  RangeKey,
  RecentActivityItem,
  SeriesPoint,
  Summary,
  UsageEvent,
} from "../shared/types";
import { rangeMillis } from "../shared/types";

export function windowStart(range: RangeKey, now = Date.now()): number | null {
  const span = rangeMillis(range);
  return span === null ? null : now - span;
}

export function inWindow(events: UsageEvent[], range: RangeKey, now = Date.now()): UsageEvent[] {
  const start = windowStart(range, now);
  if (start === null) return events;
  return events.filter((e) => e.timestamp >= start && e.timestamp <= now + 1000);
}

export function summarize(events: UsageEvent[]): Summary {
  const requests = events.length;
  const successes = events.filter((e) => e.status === "success").length;
  const failures = requests - successes;
  const latencies = events.map((e) => e.latencyMs).sort((a, b) => a - b);
  const tokensKnown = events.some((e) => e.totalTokens !== undefined || e.inputTokens !== undefined);
  const costKnown = events.some((e) => e.costAvailable && e.estimatedCostUsd !== undefined);
  const totalTokens = tokensKnown
    ? events.reduce(
        (acc, e) => acc + (e.totalTokens ?? (e.inputTokens ?? 0) + (e.outputTokens ?? 0)),
        0,
      )
    : null;
  return {
    requests,
    successes,
    failures,
    successRate: requests > 0 ? successes / requests : null,
    totalTokens,
    estimatedCostUsd: costKnown
      ? round6(events.reduce((acc, e) => acc + (e.estimatedCostUsd ?? 0), 0))
      : null,
    avgLatencyMs:
      requests > 0 ? Math.round(events.reduce((a, e) => a + e.latencyMs, 0) / requests) : null,
    p95LatencyMs:
      requests > 0
        ? Math.round(latencies[Math.min(latencies.length - 1, Math.floor(0.95 * latencies.length))]!)
        : null,
    activeProviders: new Set(events.map((e) => e.provider)).size,
    activeModels: new Set(events.filter((e) => e.model).map((e) => e.model)).size,
  };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function localMidnight(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Buckets events into fixed-width series points, anchored to the calendar:
 * 24h → the 24 clock hours ending now; 7d/30d → local calendar days
 * (midnight-anchored, zero-filled so gap days render as 0); all → weekly
 * buckets from the first event. Bucket boundaries are computed by stepping
 * calendar days (Date.setDate), so they remain true local midnights across
 * DST transitions — the same event always lands under the same date label.
 */
export function buildSeries(
  events: UsageEvent[],
  range: RangeKey,
  now = Date.now(),
): SeriesPoint[] {
  const inRange = inWindow(events, range, now);
  const byBucket = new Map<number, UsageEvent[]>();
  let starts: number[];
  let bucketStart: (t: number) => number;

  if (range === "24h") {
    // Clock hours align to epoch hours in every timezone, fixed steps are safe.
    const currentHour = Math.floor(now / HOUR) * HOUR;
    starts = Array.from({ length: 24 }, (_, i) => currentHour - (23 - i) * HOUR);
    bucketStart = (t) => Math.floor(t / HOUR) * HOUR;
  } else if (range === "7d" || range === "30d") {
    const n = range === "7d" ? 7 : 30;
    starts = calendarStepsBack(localMidnight(now), n, 1);
    const index = new Set(starts);
    bucketStart = (t) => {
      const m = localMidnight(t);
      // Every calendar day in the window is present, so the event's own
      // midnight is always a bucket key — DST-safe by construction.
      return index.has(m) ? m : (starts[0] as number);
    };
  } else {
    // Weekly grid stepped in calendar weeks from the first event's day.
    const anchor = inRange.length
      ? localMidnight(Math.min(...inRange.map((e) => e.timestamp)))
      : localMidnight(now);
    starts = calendarStepsBack(localMidnight(now), weeksBetween(anchor, localMidnight(now)) + 1, 7)
      .filter((t) => t >= anchor);
    if (starts[0] !== anchor) starts.unshift(anchor);
    const sorted = [...starts].sort((a, b) => a - b);
    bucketStart = (t) => {
      // Largest grid point ≤ the event's local midnight (binary search).
      const m = localMidnight(t);
      let lo = 0;
      let hi = sorted.length - 1;
      let best = sorted[0] as number;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const v = sorted[mid] as number;
        if (v <= m) {
          best = v;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return best;
    };
  }

  for (const e of inRange) {
    const k = bucketStart(e.timestamp);
    const arr = byBucket.get(k);
    if (arr) arr.push(e);
    else byBucket.set(k, [e]);
  }

  return starts.map((t) => {
    const s = summarize(byBucket.get(t) ?? []);
    return {
      t,
      requests: s.requests,
      failures: s.failures,
      costUsd: s.estimatedCostUsd,
      latencyMs: s.avgLatencyMs,
    };
  });
}

/** True local midnights stepping back `count` steps of `days` calendar days each. */
function calendarStepsBack(fromMidnight: number, count: number, days: number): number[] {
  const out: number[] = [];
  const d = new Date(fromMidnight);
  for (let i = 0; i < count; i++) {
    out.unshift(d.getTime());
    d.setDate(d.getDate() - days);
  }
  return out;
}

function weeksBetween(fromMidnight: number, toMidnight: number): number {
  return Math.floor((toMidnight - fromMidnight) / (7 * DAY));
}

export function breakdown(
  events: UsageEvent[],
  keyFn: (e: UsageEvent) => string,
): BreakdownEntry[] {
  const map = new Map<string, { requests: number; cost: number; costKnown: boolean }>();
  for (const e of events) {
    const k = keyFn(e);
    const cur = map.get(k) ?? { requests: 0, cost: 0, costKnown: false };
    cur.requests += 1;
    if (e.costAvailable && e.estimatedCostUsd !== undefined) {
      cur.cost += e.estimatedCostUsd;
      cur.costKnown = true;
    }
    map.set(k, cur);
  }
  const total = events.length || 1;
  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      requests: v.requests,
      share: v.requests / total,
      costUsd: v.costKnown ? round6(v.cost) : null,
    }))
    .sort((a, b) => b.requests - a.requests);
}

export function recentActivity(events: UsageEvent[], limit = 10): RecentActivityItem[] {
  return [...events]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit)
    .map((e) => ({
      eventId: e.eventId,
      timestamp: e.timestamp,
      provider: e.provider,
      model: e.model,
      credentialId: e.credentialId,
      status: e.status,
      latencyMs: e.latencyMs,
      errorCategory: e.errorCategory,
      estimatedCostUsd: e.estimatedCostUsd,
    }));
}

/**
 * Models whose requests succeeded with reported usage but no applicable
 * pricing — i.e. genuinely "pricing unknown". Events where the provider
 * reported no usage at all are excluded (nothing was estimable, but pricing
 * is not the thing that was missing).
 */
export function modelsWithoutPricing(events: UsageEvent[]): string[] {
  const out = new Set<string>();
  for (const e of events) {
    if (!e.costAvailable && e.usageReported !== false && e.model && e.status === "success") {
      out.add(`${e.provider}:${e.model}`);
    }
  }
  return [...out];
}

export function dailyTotals(
  events: UsageEvent[],
  range: RangeKey,
  now = Date.now(),
): { date: string; requests: number; costUsd: number | null; tokens: number | null }[] {
  const inRange = inWindow(events, range, now);
  if (inRange.length === 0) return [];
  const map = new Map<string, { requests: number; cost: number; costKnown: boolean; tokens: number; tokensKnown: boolean }>();
  for (const e of inRange) {
    const d = new Date(e.timestamp);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const cur = map.get(dateStr) ?? { requests: 0, cost: 0, costKnown: false, tokens: 0, tokensKnown: false };
    cur.requests += 1;
    if (e.costAvailable && e.estimatedCostUsd !== undefined) {
      cur.cost += e.estimatedCostUsd;
      cur.costKnown = true;
    }
    const tokens = e.totalTokens ?? (e.inputTokens ?? 0) + (e.outputTokens ?? 0);
    if (tokens > 0) {
      cur.tokens += tokens;
      cur.tokensKnown = true;
    }
    map.set(dateStr, cur);
  }
  // Sort by date ascending
  const sorted = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return sorted.map(([date, v]) => ({
    date,
    requests: v.requests,
    costUsd: v.costKnown ? round6(v.cost) : null,
    tokens: v.tokensKnown ? v.tokens : null,
  }));
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
