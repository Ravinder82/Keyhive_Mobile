# DECISIONS/monetization.md

**Status:** Accepted (v1.1) · **Scope:** freemium tiers, licensing, enforcement

## Decision

Freemium with a one-time $19 **Pro** license, sold through **Dodo Payments** (merchant of record — handles global VAT/sales tax, payouts to Indian sellers, built-in license-key API). **No accounts, no backend of ours, no subscriptions** in v1.x.

| | Free | Pro ($19 once) |
| --- | --- | --- |
| Credentials | 2 (existing over-cap credentials **grandfathered** — only new adds gated) | Unlimited |
| Analytics ranges | 24h, 7d | + 30d, All time |
| Insight layers | ★ Need to Know, ⚠ Needs Attention | + ◔ Watch, ✓ Healthy |
| Expanded dashboard tab | — | ✓ |
| Cost estimates | Basic (always) | Basic (always) |

## Mechanics

- **Activation:** user pastes the license key (Settings → Pro, or the upgrade modal) → one HTTPS call to `api.dodopayments.com/v1/licenses/activate` with a device instance name → entitlement stored in `chrome.storage.local` (readable pre-unlock so the Pro badge renders immediately).
- **Revalidation: LAZY, user-initiated** — only on popup open and only if the last successful validation is >7 days old. No `alarms` permission, no timers, no scheduled egress.
- **Degradation:** an explicit invalid/expired/disabled verdict downgrades the tier (features revert, **data is never deleted**); a network flake keeps the current state.
- **Enforcement:** one choke point — the background message router returns typed `entitlement_required`; UI hiding (badge, locked range tabs, upgrade modal) is cosmetic defense only.
- **Abuse posture:** Dodo activation limit (~5 instances) + user-facing deactivate + manual disabling of refunded/leaked keys in the vendor dashboard (documented ops task). No DRM beyond this — acceptable shrinkage for a $19 dev tool.
- **Restore purchase:** re-paste the key (there is nothing account-bound to restore).

## Rejected alternatives (with reasons)

- **Accounts/OAuth + our backend:** high effort, GDPR controller role, betrays the "local-first, no server" promise that is the product.
- **ExtensionPay-style remote SDK:** loads remote code → CWS Manifest V3 violation.
- **Offline signed keys (Ed25519):** without a backend nothing mints per-customer signatures; static keys are shareable. Revisit only if key leakage becomes material.
- **Scheduled revalidation via chrome.alarms:** new permission + background egress smell for zero UX gain over lazy validation.

## Compliance deltas shipped in the same change

New host permission `https://api.dodopayments.com/*` (see DECISIONS/permissions.md); COMPLIANCE.md egress + Limited-Use/GDPR rows updated; PRIVACY_POLICY.md gains "purchase/license data → Lemon-Squeezy-class processor (Dodo Payments)" disclosure; RELEASE.md store disclosures gain the free/Pro split. Listing copy presents gated features as Pro (no bait-and-switch vs 1.0).

## Grandfathering rule (Inspector-required)

Users who saved more than 2 credentials before v1.1 (or before a downgrade) keep every credential fully usable — test, delete, read. The cap applies **only to adding new credentials** while on the free tier. Holding users' own secrets hostage was rejected as an ethical failure and a review bomb.
