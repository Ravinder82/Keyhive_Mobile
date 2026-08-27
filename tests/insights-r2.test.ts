/**
 * Phase R2 insight tests: spec §14 coverage additions and the
 * deterministic Watch/Healthy repeat suppression.
 */
import { describe, expect, it } from "vitest";
import { applyRepeatSuppression, generateInsights, SUPPRESSION_WINDOW_MS } from "../src/insights/engine";
import type { UsageEvent } from "../src/shared/types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.now();

function evt(p: Partial<UsageEvent>, ageMs = 0): UsageEvent {
  return {
    eventId: Math.random().toString(36).slice(2),
    schemaVersion: 1,
    timestamp: NOW - ageMs,
    provider: "openai",
    model: "gpt-4o-mini",
    credentialId: "c1",
    status: "success",
    latencyMs: 400,
    costAvailable: false,
    usageReported: false,
    testKind: "manual-test",
    ...p,
  };
}

function run(current: UsageEvent[], previous: UsageEvent[] = []) {
  return generateInsights({
    range: "7d",
    current,
    previous,
    now: NOW,
    scopeLabel: "all",
    scope: {},
  });
}

describe("spec §14 additions — needs attention", () => {
  it("flags timeout spikes (≥2 timeouts)", () => {
    const out = run([
      evt({ status: "failure", errorCategory: "timeout" }, HOUR),
      evt({ status: "failure", errorCategory: "timeout" }, 2 * HOUR),
    ]);
    const i = out.find((x) => x.id.includes("attention-timeouts"));
    expect(i).toBeDefined();
    expect(i!.title).toContain("Timeout spike");
  });

  it("flags unavailable models (not_found)", () => {
    const out = run([
      evt({ status: "failure", errorCategory: "not_found", model: "gpt-archived" }, HOUR),
    ]);
    const i = out.find((x) => x.id.includes("attention-model-unavailable"));
    expect(i).toBeDefined();
    expect(i!.metrics.some((m) => m.value.includes("gpt-archived"))).toBe(true);
  });

  it("flags repeated provider failures (≥3 server errors)", () => {
    const out = run(
      Array.from({ length: 4 }, (_, k) =>
        evt({ status: "failure", errorCategory: "server_error" }, (k + 1) * HOUR),
      ),
    );
    expect(out.find((x) => x.id.includes("attention-provider-failures"))).toBeDefined();
  });

  it("does not fire the new attention rules below thresholds", () => {
    const out = run([
      evt({ status: "failure", errorCategory: "timeout" }, HOUR),
      evt({ status: "failure", errorCategory: "server_error" }, 2 * HOUR),
      evt({ status: "failure", errorCategory: "server_error" }, 3 * HOUR),
    ]);
    expect(out.find((x) => x.id.includes("attention-timeouts"))).toBeUndefined();
    expect(out.find((x) => x.id.includes("attention-provider-failures"))).toBeUndefined();
  });
});

describe("spec §14 additions — watch & healthy", () => {
  it("watches cost growth ≥15% (below the Need-to-Know threshold)", () => {
    const current = Array.from({ length: 8 }, (_, k) =>
      evt({ estimatedCostUsd: 0.02, costAvailable: true, usageReported: true }, k * HOUR),
    );
    const previous = Array.from({ length: 8 }, (_, k) =>
      evt({ estimatedCostUsd: 0.015, costAvailable: true, usageReported: true }, 8 * DAY + k * HOUR),
    );
    const out = run(current, previous);
    const w = out.find((x) => x.id.includes("watch-cost-up"));
    expect(w).toBeDefined();
    expect(w!.title).toMatch(/spend up \d+%/);
  });

  it("watches provider concentration (≥90% on one of several providers)", () => {
    const current = [
      ...Array.from({ length: 12 }, (_, k) => evt({}, k * HOUR)),
      evt({ provider: "anthropic", credentialId: "c2" }, HOUR),
    ];
    const previous = [
      ...Array.from({ length: 4 }, (_, k) => evt({}, 8 * DAY + k * HOUR)),
      evt({ provider: "anthropic", credentialId: "c2" }, 8 * DAY),
    ];
    const out = run(current, previous);
    const w = out.find((x) => x.id.includes("watch-provider-concentration"));
    expect(w).toBeDefined();
    expect(w!.title).toMatch(/% of traffic on one provider/);
  });

  it("rewards reduced spending (healthy-cost-down)", () => {
    const current = Array.from({ length: 8 }, (_, k) =>
      evt({ estimatedCostUsd: 0.005, costAvailable: true, usageReported: true }, k * HOUR),
    );
    const previous = Array.from({ length: 8 }, (_, k) =>
      evt({ estimatedCostUsd: 0.02, costAvailable: true, usageReported: true }, 8 * DAY + k * HOUR),
    );
    const out = run(current, previous);
    expect(out.find((x) => x.id.includes("healthy-cost-down"))).toBeDefined();
  });

  it("rewards clean authentication history (healthy-no-auth-failures)", () => {
    const out = run(Array.from({ length: 12 }, (_, k) => evt({}, k * HOUR)));
    const h = out.find((x) => x.id.includes("healthy-no-auth-failures"));
    expect(h).toBeDefined();
    expect(h!.title).toContain("No authentication failures");
  });
});

describe("applyRepeatSuppression (Watch/Healthy dedupe)", () => {
  const watch = run(
    Array.from({ length: 10 }, (_, k) => evt({}, k * HOUR)),
    Array.from({ length: 5 }, (_, k) => evt({}, 8 * DAY + k * HOUR)),
  ).find((x) => x.id.includes("watch-usage-up"))!;

  it("suppresses a Watch insight already shown inside the window", () => {
    const { insights } = applyRepeatSuppression([watch], { [watch.id]: NOW - HOUR }, NOW);
    expect(insights).toHaveLength(0);
  });

  it("shows it again once the suppression window has passed", () => {
    const { insights } = applyRepeatSuppression(
      [watch],
      { [watch.id]: NOW - SUPPRESSION_WINDOW_MS - 1 },
      NOW,
    );
    expect(insights).toHaveLength(1);
  });

  it("never suppresses Need to Know or Needs Attention", () => {
    const attention = run([
      evt({ status: "failure", errorCategory: "auth_invalid" }, HOUR),
    ]).find((x) => x.layer === "needs_attention")!;
    const { insights } = applyRepeatSuppression([attention], { [attention.id]: NOW - HOUR }, NOW);
    expect(insights).toHaveLength(1);
  });

  it("records seen ids and prunes week-old entries", () => {
    const ancient = { "old-id": NOW - 8 * 7 * 24 * HOUR };
    const { seen } = applyRepeatSuppression([watch], ancient, NOW);
    expect(seen["old-id"]).toBeUndefined();
    expect(seen[watch.id]).toBe(NOW);
  });

  it("is deterministic for identical inputs", () => {
    const a = applyRepeatSuppression([watch], {}, NOW);
    const b = applyRepeatSuppression([watch], {}, NOW);
    expect(a).toEqual(b);
  });

  it("resurfaces 24h after first show even with frequent polling", () => {
    // Poll every hour for 23 hours: the insight stays suppressed and its
    // seen-timestamp must NOT slide forward.
    let seen: Record<string, number> = {};
    const firstShow = applyRepeatSuppression([watch], seen, NOW);
    seen = firstShow.seen;
    for (let h = 1; h <= 23; h++) {
      const r = applyRepeatSuppression([watch], seen, NOW + h * HOUR);
      seen = r.seen;
      expect(r.insights).toHaveLength(0);
      expect(seen[watch.id]).toBe(NOW); // anchored to first show, not last poll
    }
    // An hour past the anchored window → resurfaces.
    const resurfaced = applyRepeatSuppression([watch], seen, NOW + 25 * HOUR);
    expect(resurfaced.insights).toHaveLength(1);
  });
});
