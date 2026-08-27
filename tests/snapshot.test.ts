import { describe, expect, it } from "vitest";
import { buildSnapshot } from "../src/background/main";
import type { CredentialMeta, RangeKey, UsageEvent } from "../src/shared/types";

const HOUR = 3_600_000;
const DAY_OFFSET = 24 * HOUR;
const NOW = Date.now();

const creds: CredentialMeta[] = [
  {
    id: "c1",
    label: "OpenAI work",
    provider: "openai",
    maskedHint: "sk-…abcd",
    createdAt: NOW - 10 * 24 * HOUR,
  },
  {
    id: "c2",
    label: "Claude personal",
    provider: "anthropic",
    maskedHint: "sk-ant-…ef12",
    createdAt: NOW - 5 * 24 * HOUR,
  },
];

function evt(p: Partial<UsageEvent>, ageMs: number): UsageEvent {
  return {
    eventId: `e-${p.credentialId ?? "c1"}-${ageMs}`,
    schemaVersion: 1,
    timestamp: NOW - ageMs,
    provider: "openai",
    model: "gpt-4o-mini",
    credentialId: "c1",
    status: "success",
    latencyMs: 420,
    costAvailable: true,
    usageReported: true,
    estimatedCostUsd: 0.0001,
    testKind: "manual-test",
    ...p,
  };
}

describe("background snapshot builder", () => {
  it("aggregates the global dashboard over 7d with a previous-window comparison", () => {
    const events: UsageEvent[] = [
      ...Array.from({ length: 6 }, (_, i) => evt({}, i * HOUR)),
      ...Array.from({ length: 4 }, (_, i) => evt({}, 8 * DAY_OFFSET + i * HOUR)),
    ];
    const snap = buildSnapshot(creds, events, { autoLockMinutes: 30 }, "7d", null);
    expect(snap.global.summary.requests).toBe(6);
    expect(snap.global.previousSummary?.requests).toBe(4);
    expect(snap.global.hasAnyDataEver).toBe(true);
    expect(snap.credential).toBeNull();
    expect(snap.credentials).toHaveLength(2);
  });

  it("scopes the credential dashboard to the selected credential", () => {
    const events: UsageEvent[] = [
      evt({}, HOUR),
      evt({ credentialId: "c2", provider: "anthropic", model: "claude-3-5-haiku-20241022" }, 2 * HOUR),
    ];
    const snap = buildSnapshot(creds, events, { autoLockMinutes: 30 }, "7d", "c2");
    expect(snap.credential?.credential.id).toBe("c2");
    expect(snap.credential?.summary.requests).toBe(1);
    expect(snap.global.summary.requests).toBe(2);
    expect(snap.credential?.modelBreakdown[0]!.key).toBe("claude-3-5-haiku-20241022");
    // Context-switched insights target the selected credential.
    expect(snap.insights.every((i) => i.scope.credentialId === "c2" || i.scope.credentialId === undefined)).toBe(true);
  });

  it("reports empty state honestly when no data has ever been recorded", () => {
    const snap = buildSnapshot(creds, [], { autoLockMinutes: 30 }, "7d", null);
    expect(snap.global.hasAnyDataEver).toBe(false);
    expect(snap.global.summary.requests).toBe(0);
    expect(snap.global.summary.successRate).toBeNull();
    expect(snap.global.series).toHaveLength(7); // zero-filled calendar days
    expect(snap.global.series.every((p) => p.requests === 0)).toBe(true);
    expect(snap.insights).toHaveLength(0);
  });

  it("omits comparison summaries when range is 'all'", () => {
    const events = [evt({}, HOUR), evt({}, 40 * DAY_OFFSET)];
    const snap = buildSnapshot(creds, events, { autoLockMinutes: 0 }, "all", null);
    expect(snap.global.summary.requests).toBe(2);
    expect(snap.global.previousSummary).toBeNull();
  });

  it("maps recent activity labels to credential names", () => {
    const events = [evt({ credentialId: "c2", provider: "anthropic" }, HOUR)];
    const snap = buildSnapshot(creds, events, { autoLockMinutes: 30 }, "7d", null);
    expect(snap.global.recentActivity[0]!.credentialLabel).toBe("Claude personal");
  });
});
