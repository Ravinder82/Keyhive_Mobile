/**
 * Premium configuration. The publisher fills these in after creating the
 * product in the Dodo Payments dashboard (TASK_TRACKING PR-10).
 */

/** Landing/buy page shown by the Upgrade screen ("Buy Pro — $19"). */
export const BUY_PRO_URL =
  "https://example.com/buy-pro"; // TODO(PR-10): replace with the live Dodo checkout/product URL.

/** Dodo Payments license API base (Reference Policy: verify against current docs). */
export const LICENSE_API_BASE = "https://api.dodopayments.com/v1";

/** Lazy revalidation: only when the last successful validation is older than this. */
export const REVALIDATE_AFTER_MS = 7 * 24 * 3_600_000;

/** How long a network flake may leave the current entitlement untouched. */
export const VALIDATE_TIMEOUT_MS = 10_000;
