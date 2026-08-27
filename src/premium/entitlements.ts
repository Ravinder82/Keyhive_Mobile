/**
 * Premium entitlements (doc: DECISIONS/monetization.md).
 *
 * Rules:
 *  - The entitlement record lives in chrome.storage.local and is readable
 *    WITHOUT unlocking the vault (the Pro badge renders pre-unlock).
 *  - Free tier: 2 credentials (existing over-cap credentials are GRANDFATHERED
 *    — only new additions are gated), 24h/7d ranges, ★ Need to Know +
 *    ⚠ Needs Attention insights, basic cost estimates.
 *  - Pro: unlimited credentials, 30d/All-time ranges, 👁 Watch + ✓ Healthy,
 *    expanded dashboard tab.
 *  - Downgrade reverts FEATURES, never data.
 */

import type { RangeKey } from "../shared/types";

export type Tier = "free" | "pro";

export interface EntitlementRecord {
  tier: Tier;
  licenseKey?: string;
  instanceId?: string;
  status: "active" | "inactive";
  lastValidatedAt?: number;
}

export const FREE_MAX_CREDENTIALS = 2;
export const FREE_RANGES: readonly RangeKey[] = ["24h", "7d"];
export const FREE_INSIGHT_LAYERS = ["need_to_know", "needs_attention"] as const;

export const FREE_ENTITLEMENT: EntitlementRecord = { tier: "free", status: "inactive" };

export function isPro(ent: EntitlementRecord): boolean {
  return ent.tier === "pro" && ent.status === "active";
}

export function isRangeAllowed(range: RangeKey, ent: EntitlementRecord): boolean {
  return isPro(ent) || (FREE_RANGES as readonly string[]).includes(range);
}

export function layerAllowed(
  layer: "need_to_know" | "needs_attention" | "watch" | "healthy",
  ent: EntitlementRecord,
): boolean {
  return isPro(ent) || (FREE_INSIGHT_LAYERS as readonly string[]).includes(layer);
}

export const PRO_FEATURES = [
  "Unlimited credentials",
  "30-day and all-time analytics ranges",
  "Watch + Healthy insight layers",
  "Expanded dashboard tab",
  "Priority support",
] as const;
