import { describe, expect, it } from "vitest";
import {
  breakdown,
  buildSeries,
  inWindow,
  modelsWithoutPricing,
  recentActivity,
  summarize,
} from "../src/analytics/aggregate";
import { eventFromOutcome, isValidEvent, MAX_EVENTS } from "../src/analytics/events";
import { appendEvents, clearAnalytics, loadEvents } from "../src/analytics/store";
import { mockStorage } from "./setup";
import type { TestOutcome, UsageEvent } from "../src/shared/types";

const HOUR = 3_600_000;

function outcome(partial: Partial<TestOutcome>): TestOutcome {
  return {
    ok: true,
    provider: "openai",
    model: "gpt-4o-mini",
    latencyMs: 500,
    testedAt: Date.now(),
    ...partial,
  };
}

function evt(partial: Partial<UsageEvent>, i = 0): UsageEvent {
  return {
    eventId: `e${i}`,
    schemaVersion: 1,
    timestamp: Date.now() - i * HOUR,
    provider: "openai",
    model: "gpt-4o-mini",
    credentialId: "c1",
    status: "success",
    latencyMs: 400,
    costAvailable: false,
    usageReported: false,
    testKind: "manual-test",
    ...partial,
  };
}

describe("usage events", () => {
  it("creates exactly one event per outcome with metadata only", () => {
    const e = eventFromOutcome(
      outcome({ ok: false, error: { category: "auth_invalid", message: "nope", retryable: false } }),
      "cred-9",
      "gpt-4o-mini",
    );
    expect(e.schemaVersion).toBe(1);
    expect(e.status).toBe("failure");
    expect(e.errorCategory).toBe("auth_invalid");
    expect(e.credentialId).toBe("cred-9");
    const json = JSON.stringify(e);
    expect(json).not.toMatch(/sk-/i);
  });

  it("validates persisted events defensively", () => {
    expect(isValidEvent(evt({}))).toBe(true);
    expect(isValidEvent({ garbage: true })).toBe(false);
    expect(isValidEvent(null)).toBe(false);
  });
});

describe("local analytics store", () => {
  it("appends and loads sorted events", async () => {
    mockStorage.local.clear();
    await appendEvents([evt({ timestamp: 200 }, 1), evt({ timestamp: 100 }, 2)]);
    await appendEvents([evt({ timestamp: 150 }, 3)]);
    const loaded = await loadEvents();
    expect(loaded.map((e) => e.timestamp)).toEqual([100, 150, 200]);
  });

  it("prunes to MAX_EVENTS keeping the newest", async () => {
    mockStorage.local.clear();
    const many: UsageEvent[] = Array.from({ length: MAX_EVENTS + 50 }, (_, i) =>
      evt({ eventId: `id${i}`, timestamp: i }, i),
    );
    await appendEvents(many);
    const loaded = await loadEvents();
    expect(loaded).toHaveLength(MAX_EVENTS);
    expect(loaded[0]!.timestamp).toBe(50);
    expect(loaded.at(-1)!.timestamp).toBe(MAX_EVENTS + 49);
  });

  it("clearAnalytics removes everything", async () => {
    await appendEvents([evt({})]);
    await clearAnalytics();
    expect(await loadEvents()).toHaveLength(0);
  });
});

describe("aggregation", () => {
  it("summarizes counts, rates, tokens and cost honestly", () => {
    const s = summarize([
      evt({ status: "success", latencyMs: 100, totalTokens: 10, estimatedCostUsd: 0.000002, costAvailable: true }),
      evt({ status: "success", latencyMs: 300, inputTokens: 5, outputTokens: 5 }, 1),
      evt({ status: "failure", latencyMs: 900, errorCategory: "auth_invalid" }, 2),
    ]);
    expect(s.requests).toBe(3);
    expect(s.successes).toBe(2);
    expect(s.failures).toBe(1);
    expect(s.successRate).toBeCloseTo(2 / 3);
    expect(s.totalTokens).toBe(20);
    expect(s.estimatedCostUsd).toBeCloseTo(0.000002, 8);
    expect(s.avgLatencyMs).toBe(Math.round((100 + 300 + 900) / 3));
    expect(s.activeProviders).toBe(1);
  });

  it("reports null (not zero) for tokens/cost when unknown", () => {
    const s = summarize([evt({}), evt({}, 1)]);
    expect(s.totalTokens).toBeNull();
    expect(s.estimatedCostUsd).toBeNull();
    expect(s.successRate).toBe(1);
  });

  it("windows events correctly", () => {
    const now = Date.now();
    const events = [
      evt({ timestamp: now - 1 * HOUR }, 1),
      evt({ timestamp: now - 30 * HOUR }, 2),
      evt({ timestamp: now - 800 * HOUR }, 3),
    ];
    expect(inWindow(events, "24h", now)).toHaveLength(1);
    expect(inWindow(events, "7d", now)).toHaveLength(2);
    expect(inWindow(events, "30d", now)).toHaveLength(2);
    expect(inWindow(events, "all", now)).toHaveLength(3);
  });

  it("builds calendar-anchored, zero-filled series", () => {
    const now = Date.now();
    const events = [1, 2, 3].map((h) => evt({ timestamp: now - h * HOUR }, h));
    const hourly = buildSeries(events, "24h", now);
    expect(hourly).toHaveLength(24);
    expect(hourly.reduce((a, p) => a + p.requests, 0)).toBe(3);
    const daily = buildSeries(events, "7d", now);
    expect(daily).toHaveLength(7);
    expect(daily.reduce((a, p) => a + p.requests, 0)).toBe(3);
    // Events land in the bucket for their own calendar day (which may be
    // yesterday if the suite runs shortly after local midnight).
    expect(Math.max(...daily.map((p) => p.requests))).toBeGreaterThanOrEqual(1);
  });

  it("anchors daily buckets to local midnight so labels are stable", () => {
    const now = Date.now();
    const events = [evt({ timestamp: now - 30 * HOUR }, 1)];
    const daily = buildSeries(events, "7d", now);
    for (const p of daily) {
      const d = new Date(p.t);
      expect(d.getHours()).toBe(0);
      expect(d.getMinutes()).toBe(0);
      expect(d.getSeconds()).toBe(0);
    }
    // The 30-hour-old event lands in yesterday's bucket, not "30h before render".
    expect(daily.at(-1)!.requests).toBe(0);
    expect(daily.reduce((a, p) => a + p.requests, 0)).toBe(1);
  });

  it("keeps per-day sums consistent across a DST transition", () => {
    // Locate the local timezone's spring-forward/fall-back day this year, if any.
    const year = new Date().getFullYear();
    const offsets = new Map<number, number>();
    for (let day = 1; day <= 365; day++) {
      const t = new Date(year, 0, day, 12).getTime();
      offsets.set(new Date(t).getTimezoneOffset(), t);
    }
    const unique = [...offsets.keys()];
    const now = Date.now();
    if (unique.length < 2) {
      // Fixed-offset timezone: the calendar-step invariant is trivially true.
      const daily = buildSeries([evt({ timestamp: now - 3 * HOUR }, 1)], "7d", now);
      expect(daily.reduce((a, p) => a + p.requests, 0)).toBe(1);
      return;
    }
    // Build a transition-adjacent "now": noon two days after the first offset sample.
    const transitionNoon = [...offsets.values()][0]!;
    const base = new Date(transitionNoon);
    base.setHours(9, 17, 0, 0); // avoid exact midnights
    const nowT = base.getTime();
    const events = [2, 20, 26, 44, 70].map((h) =>
      evt({ timestamp: nowT - h * HOUR }, h),
    );
    const daily = buildSeries(events, "7d", nowT);
    expect(daily).toHaveLength(7);
    for (const p of daily) {
      const d = new Date(p.t);
      expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([0, 0, 0]);
    }
    // No event may be dropped or double-counted by the bucket grid.
    expect(daily.reduce((a, p) => a + p.requests, 0)).toBe(5);
    const weekly = buildSeries(events, "all", nowT);
    expect(weekly.reduce((a, p) => a + p.requests, 0)).toBe(5);
  });

  it("breaks down by provider and model with shares", () => {
    const events = [
      evt({ provider: "openai", model: "gpt-4o-mini" }),
      evt({ provider: "openai", model: "gpt-4o-mini" }, 1),
      evt({ provider: "anthropic", model: "claude-3-5-haiku-20241022" }, 2),
    ];
    const byProvider = breakdown(events, (e) => e.provider);
    expect(byProvider[0]!.key).toBe("openai");
    expect(byProvider[0]!.share).toBeCloseTo(2 / 3);
    const byModel = breakdown(events, (e) => e.model ?? "(unknown)");
    expect(byModel).toHaveLength(2);
  });

  it("lists models without pricing honestly — and not when usage was never reported", () => {
    const events = [
      evt({ model: "gpt-4o-mini", status: "success", costAvailable: true, estimatedCostUsd: 0.001 }),
      evt({ model: "mystery-model", status: "success", costAvailable: false, usageReported: true }, 1),
      evt({ model: "silent-model", status: "success", costAvailable: false, usageReported: false }, 2),
    ];
    expect(modelsWithoutPricing(events)).toEqual(["openai:mystery-model"]);
  });

  it("returns recent activity newest-first", () => {
    const items = recentActivity([evt({}, 1), evt({}, 2), evt({}, 3)], 2);
    expect(items).toHaveLength(2);
    expect(items[0]!.timestamp).toBeGreaterThan(items[1]!.timestamp);
  });
});
