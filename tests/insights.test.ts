import { describe, expect, it } from "vitest";
import { generateInsights } from "../src/insights/engine";
import type { CredentialMeta, UsageEvent } from "../src/shared/types";

const DAY = 86_400_000;
const HOUR = 3_600_000;
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

const cred: CredentialMeta = {
  id: "c1",
  label: "Work key",
  provider: "openai",
  maskedHint: "sk-…abcd",
  createdAt: NOW - 30 * DAY,
};

describe("insights — needs attention", () => {
  it("flags authentication failures immediately", () => {
    const current = [
      evt({ status: "failure", errorCategory: "auth_invalid" }, HOUR),
      evt({ status: "failure", errorCategory: "auth_invalid" }, 2 * HOUR),
      evt({}, 3 * HOUR),
    ];
    const out = generateInsights({
      range: "7d",
      current,
      previous: [],
      now: NOW,
      scopeLabel: '"Work key"',
      scope: {},
    });
    const auth = out.find((i) => i.id.startsWith("attention-auth"));
    expect(auth).toBeDefined();
    expect(auth!.layer).toBe("needs_attention");
    expect(auth!.title).toContain("2 authentication failures");
    expect(auth!.detail).toContain("unauthorized");
  });

  it("flags high failure rate with sufficient sample", () => {
    const current = Array.from({ length: 10 }, (_, i) =>
      evt({ status: i < 4 ? "failure" : "success", errorCategory: i < 4 ? "server_error" : undefined }, i * HOUR),
    );
    const out = generateInsights({
      range: "7d",
      current,
      previous: [],
      now: NOW,
      scopeLabel: "all",
      scope: {},
    });
    expect(out.find((i) => i.id.startsWith("attention-failures"))).toBeDefined();
  });
});

describe("insights — insufficient data suppression", () => {
  it("creates no comparative insights from an empty history", () => {
    const out = generateInsights({
      range: "7d",
      current: [],
      previous: [],
      now: NOW,
      scopeLabel: "all",
      scope: {},
    });
    expect(out).toHaveLength(0);
  });

  it("does not fabricate comparisons without a previous window", () => {
    const current = Array.from({ length: 6 }, (_, i) => evt({}, i * HOUR));
    const out = generateInsights({
      range: "7d",
      current,
      previous: [],
      now: NOW,
      scopeLabel: "all",
      scope: {},
    });
    expect(out.find((i) => i.layer === "need_to_know")).toBeUndefined();
    expect(out.find((i) => i.id.includes("watch-usage-up"))).toBeUndefined();
  });
});

describe("insights — need to know & watch", () => {
  it("raises a cost spike when spend grows ≥25% with adequate baseline", () => {
    const current = Array.from({ length: 10 }, (_, i) =>
      evt({ estimatedCostUsd: 0.02, costAvailable: true }, i * HOUR),
    );
    const previous = Array.from({ length: 10 }, (_, i) =>
      evt({ estimatedCostUsd: 0.01, costAvailable: true }, 7 * DAY + i * HOUR),
    );
    const out = generateInsights({
      range: "7d",
      current,
      previous,
      now: NOW,
      scopeLabel: "all credentials",
      scope: {},
    });
    const ntk = out.find((i) => i.layer === "need_to_know");
    expect(ntk).toBeDefined();
    expect(ntk!.id).toContain("ntk-cost-spike");
    expect(ntk!.title).toMatch(/spend .*% above/);
    expect(ntk!.metrics.length).toBeGreaterThanOrEqual(2);
  });

  it("watches usage growth ≥25%", () => {
    const current = Array.from({ length: 10 }, (_, i) => evt({}, i * HOUR));
    const previous = Array.from({ length: 6 }, (_, i) => evt({}, 7 * DAY + i * HOUR));
    const out = generateInsights({
      range: "7d",
      current,
      previous,
      now: NOW,
      scopeLabel: "all",
      scope: {},
    });
    const w = out.find((i) => i.id.includes("watch-usage-up"));
    expect(w).toBeDefined();
    expect(w!.title).toMatch(/Usage up \d+%/);
  });

  it("suppresses small fluctuations below thresholds", () => {
    const current = Array.from({ length: 10 }, (_, i) => evt({ latencyMs: 500 }, i * HOUR));
    const previous = Array.from({ length: 10 }, (_, i) =>
      evt({ latencyMs: 480 }, 7 * DAY + i * HOUR),
    );
    const out = generateInsights({
      range: "7d",
      current,
      previous,
      now: NOW,
      scopeLabel: "all",
      scope: {},
    });
    expect(out.find((i) => i.id.includes("watch-latency-up"))).toBeUndefined();
    expect(out.find((i) => i.id.includes("attention-latency"))).toBeUndefined();
  });
});

describe("insights — healthy", () => {
  it("rewards a high success rate with enough volume", () => {
    const current = Array.from({ length: 25 }, (_, i) => evt({}, i * HOUR));
    const out = generateInsights({
      range: "7d",
      current,
      previous: [],
      now: NOW,
      scopeLabel: "all",
      scope: {},
    });
    const h = out.find((i) => i.id.includes("healthy-success-rate"));
    expect(h).toBeDefined();
    expect(h!.title).toContain("100% success rate");
  });

  it("celebrates a passing last test on a credential", () => {
    const out = generateInsights({
      range: "24h",
      current: [],
      previous: [],
      now: NOW,
      scopeLabel: '"Work key"',
      credential: { ...cred, lastTestedAt: NOW - HOUR, lastTestStatus: "success" },
      scope: { credentialId: cred.id },
    });
    const h = out.find((i) => i.id.includes("healthy-test-pass"));
    expect(h).toBeDefined();
    expect(h!.title).toContain("passed its last API test");
  });
});

describe("insights — determinism & ranking", () => {
  it("is deterministic: same inputs ⇒ identical output", () => {
    const current = [evt({ status: "failure", errorCategory: "auth_invalid" }, HOUR)];
    const args = {
      range: "7d" as const,
      current,
      previous: [] as UsageEvent[],
      now: NOW,
      scopeLabel: "all",
      scope: {},
    };
    expect(generateInsights(args)).toEqual(generateInsights(args));
  });

  it("produces stable ids for identical conditions (duplicate suppression key)", () => {
    const mk = () =>
      generateInsights({
        range: "7d",
        current: [evt({ status: "failure", errorCategory: "auth_invalid" }, HOUR)],
        previous: [],
        now: NOW,
        scopeLabel: "all",
        scope: {},
      });
    expect(mk().map((i) => i.id)).toEqual(mk().map((i) => i.id));
  });

  it("caps layers and sorts by score within layer", () => {
    const current = [
      ...Array.from({ length: 5 }, (_, i) =>
        evt({ status: "failure", errorCategory: "auth_invalid" }, i * HOUR),
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        evt({ status: "failure", errorCategory: "rate_limited" }, i * HOUR),
      ),
      ...Array.from({ length: 20 }, (_, i) => evt({}, i * HOUR)),
    ];
    const out = generateInsights({
      range: "7d",
      current,
      previous: [],
      now: NOW,
      scopeLabel: "all",
      scope: {},
    });
    const attention = out.filter((i) => i.layer === "needs_attention");
    expect(attention.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < attention.length; i++) {
      expect(attention[i - 1]!.score).toBeGreaterThanOrEqual(attention[i]!.score);
    }
    // Every insight explains itself.
    for (const i of out) {
      expect(i.detail.length).toBeGreaterThan(10);
      expect(i.metrics.length).toBeGreaterThan(0);
      expect(i.confidence).toBeGreaterThan(0);
      expect(i.score).toBeGreaterThan(0);
    }
  });
});
