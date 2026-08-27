/**
 * Usage event schema (doc §16) + construction from sanitized test outcomes.
 * Events contain metadata only — never API keys, headers, prompts or
 * completions. One completed request ⇒ exactly one event.
 */

import type { ProviderId, TestOutcome, UsageEvent } from "../shared/types";
import { uuid } from "../core/ids";

export const EVENT_SCHEMA_VERSION = 1 as const;

/** Maximum retained events (ring buffer; oldest pruned first). */
export const MAX_EVENTS = 5000;

export function eventFromOutcome(
  outcome: TestOutcome,
  credentialId: string,
  model: string | undefined,
): UsageEvent {
  return {
    eventId: uuid(),
    schemaVersion: EVENT_SCHEMA_VERSION,
    timestamp: outcome.testedAt,
    provider: outcome.provider,
    model,
    credentialId,
    status: outcome.ok ? "success" : "failure",
    errorCategory: outcome.error?.category,
    latencyMs: outcome.latencyMs,
    httpStatus: outcome.error?.httpStatus,
    inputTokens: outcome.usage?.inputTokens,
    outputTokens: outcome.usage?.outputTokens,
    totalTokens: outcome.usage?.totalTokens,
    estimatedCostUsd: outcome.cost?.totalCostUsd,
    costAvailable: outcome.cost !== undefined,
    // Distinguishes "provider reported no usage" from "pricing unknown" so the
    // UI never blames pricing when the provider simply reported nothing.
    usageReported: outcome.usage !== undefined,
    pricingVersion: outcome.cost?.pricingVersion,
    testKind: "manual-test",
  };
}

/** Defensive validation when reading persisted events back from storage. */
export function isValidEvent(e: unknown): e is UsageEvent {
  if (!e || typeof e !== "object") return false;
  const ev = e as Partial<UsageEvent>;
  return (
    typeof ev.eventId === "string" &&
    ev.schemaVersion === 1 &&
    typeof ev.timestamp === "number" &&
    typeof ev.provider === "string" &&
    typeof ev.credentialId === "string" &&
    (ev.status === "success" || ev.status === "failure") &&
    typeof ev.latencyMs === "number"
  );
}
