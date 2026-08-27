# COMPLIANCE.md — Chrome Web Store & Regulatory Compliance Audit

Status: audited 2025-08-25 against the Chrome Web Store Program Policies, Manifest V3 platform requirements, and common privacy-regulation expectations (GDPR/CCPA posture). Every row states the requirement, our status, and the evidence. **Re-audit is a mandatory RELEASE.md checklist item before every publish.**

## 1. Chrome Web Store Program Policies

| Policy | Status | Evidence / Notes |
| --- | --- | --- |
| **Single purpose** | ✅ Compliant | One narrow purpose, declared in the manifest description and listing: *secure local storage and testing of AI/API credentials with private local usage analytics*. No unrelated features (V1 scope frozen — TASK_TRACKING). |
| **Permission justification** | ✅ Compliant | Every permission is used exactly as declared and justified verbatim in RELEASE.md §5: `storage` for the encrypted vault/settings/analytics; four `host_permissions` for direct provider API calls initiated by the user. No optional-permission abuse. |
| **Least privilege** | ✅ Compliant | No `tabs`, `scripting`, `cookies`, `webRequest`, `alarms`, `identity`, `notifications`, `nativeMessaging`, no content scripts, no `externally_connectable`, no `web_accessible_resources`. Verified in `public/manifest.json`. |
| **Remote code prohibition** | ✅ Compliant | All JavaScript ships in the package (`dist/`); React is bundled by Vite; no CDN/script injection/eval; no `unsafe-eval`. Service worker is a bundled ES module. |
| **Code readability (no obfuscation)** | ✅ Compliant | Vite minification only (allowed); no string encryption, control-flow obfuscation, or anti-debugging. Unminified source is this repository. |
| **CSP (Manifest V3)** | ✅ Compliant | MV3 default CSP (`script-src 'self'`); no inline scripts in `popup.html`/`dashboard.html` (Vite emits external module scripts); no remote origins. |
| **Deceptive installation tactics** | ✅ Compliant | No install-time pages, no side-loading of other items, no settings changes, no search-engine/homepage modifications. |
| **Spam & abuse / keyword spam** | ✅ Compliant | Manifest name and description describe the product only; no trademark keyword stuffing. |
| **Minimum functionality** | ✅ Compliant | Every advertised surface works and is verified (TASK_TRACKING AK-035/LIVE; TESTING.md). |
| **Trademarks & impersonation** | ⚠️ Attention | Original procedural logo and UI do not imitate Chrome, Google Password Manager, Apple Keychain, 1Password, Bitwarden, OpenAI, or any provider brand (enforced by spec §21 and `scripts/generate-icons.mjs`). **Note for the publisher:** the product *name* "AI Keychain" uses a generic descriptive term that overlaps Apple's "Keychain" trademark in a different category; before publishing, have counsel confirm the name, or publish under an alternative name — this is a business/legal decision, not a code change. |
| **In-app purchases / payments** | ✅ N/A | No payments, subscriptions, or purchases in V1. |
| **Cryptocurrency mining** | ✅ N/A | None. |
| **Security → social engineering / data exfiltration** | ✅ Compliant | Network egress is limited to (a) the user-initiated test request to the chosen provider and (b) the user-initiated Pro license activation/validation call to the license service. No other hosts are contactable (enforced by host permissions). No logs, no telemetry (`grep`-verified: no `console.log` in shipped source). |
| **User data privacy — disclosure** | ✅ Ready | PRIVACY_POLICY.md is store-ready (host it at a public URL and link it in the listing). Data-flow disclosures for the store's "Privacy practices" tab are pre-written in RELEASE.md §6. |
| **User data privacy — Limited Use** | ✅ Compliant | Credentials and usage metadata are used solely to provide the user-facing feature (testing + local analytics). No sale, no ads, no creditworthiness, no unrelated third-party sharing, no AI-model training. |
| **Data retention & deletion** | ✅ Compliant | All data is local and user-deletable in-product: *Clear analytics*, *Delete all data* (Settings), or uninstalling the extension removes everything. Documented in SECURITY.md §5 and PRIVACY_POLICY.md. |
| **Children's data** | ✅ Compliant | Not directed at children under 13; no age-gated content; no data collection from any user off-device. |
| **Encryption at rest (best practice)** | ✅ Compliant | AES-256-GCM under PBKDF2-SHA-256 (650k iterations) — SECURITY.md §2, verified by tests. |
| **Secure transmission** | ✅ Compliant | HTTPS-only egress to pinned official provider domains; keys travel in headers, never URLs (tested). |

## 2. Manifest V3 platform requirements

| Requirement | Status | Evidence |
| --- | --- | --- |
| `manifest_version: 3` | ✅ | public/manifest.json |
| Service worker (no background page) | ✅ | `"background": { "service_worker": "background.js", "type": "module" }` |
| `minimum_chrome_version` consistent with build target | ✅ | `116` in manifest; Vite `target: "chrome116"` |
| Icons at all required sizes | ✅ | 16/32/48/128 px, procedurally generated, verified visually |
| Valid `action.default_popup` path | ✅ | `popup.html` at dist root (verified in clean install) |
| No deprecated APIs | ✅ | Only `storage`, `runtime.sendMessage`, `tabs.create` on our own extension page (no permission needed), `storage.session` (Chrome ≥102) |
| Web Crypto for all cryptography | ✅ | Native SubtleCrypto only; zero crypto dependencies |

## 3. Privacy-regulation posture (GDPR / CCPA / UK GDPR)

- **Minimal off-device processing.** The extension transmits only (a) the user-initiated provider test call and (b) the user-initiated license activation/validation call (license key + device instance id to the payment processor, Dodo Payments — disclosed in PRIVACY_POLICY.md). No accounts, no analytics pipeline, no telemetry. There is no account, no server, no analytics pipeline, no telemetry — therefore no cross-border transfer of personal data by the publisher.
- **Data controller role:** the publisher processes no personal data; all user data remains on the user's device under the user's control, which is the strongest possible data-minimization posture. PRIVACY_POLICY.md states this plainly.
- **Rights (access/erasure/portability):** satisfied by design — the user can view (masked), delete per-item, or destroy all data in-product at any time.
- **Breach notification surface:** no central data store exists to breach; residual risk is limited to the user's own device (covered by the threat model in SECURITY.md §1).
- **Recommendation for the publisher:** keep the hosted privacy-policy URL current; if a future version adds any network capability, re-run this audit before shipping (rule below).

## 4. Compliance rules for future development (mandatory)

1. **No new permission without a new ADR** in DECISIONS/permissions.md and a re-audit of this file.
2. **No new network endpoint** outside the four provider hosts; any new provider needs a manifest host_permission update, adapter, and this audit's re-run.
3. **No telemetry, logging, or remote code — ever** — unless this file and PRIVACY_POLICY.md are revised and the store listing re-submitted first.
4. **Any data-schema change** that alters what is stored must update PRIVACY_POLICY.md and the store's data-disclosure answers in the same change.
5. **Every release** re-runs the RELEASE.md §3 checklist, which includes this audit's re-verification.

## 5. Known non-code compliance considerations (publisher decisions)

| Item | Note |
| --- | --- |
| Product name trademark check | See Trademarks row in §1 — legal review recommended pre-publish. |
| Privacy policy hosting | The store requires a public URL; host PRIVACY_POLICY.md verbatim. |
| Store account & developer registration | Publisher-side; not reproducible from this repository. |
| Region-specific terms (e.g., China store variants) | Out of scope for this repository; confirm distribution regions at publish time. |
