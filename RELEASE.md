# RELEASE.md

## 1. Versioning

- Single-source version: `package.json` + `public/manifest.json` (keep both in sync; release script below checks them).
- Semver. V1.0.0 is the current release.

## 2. Production build

```bash
npm run verify          # typecheck + tests + build
```

Outputs to `dist/`:

```
dist/manifest.json          MV3 manifest
dist/background.js          service worker (ES module)
dist/popup.html + popup.js  action popup
dist/dashboard.html + …     expanded dashboard tab
dist/assets/*               shared chunk + css
dist/icons/icon{16,32,48,128}.png
```

## 3. Release checklist

1. [ ] `npm run verify` green (tests, typecheck, build)
2. [ ] `dist/manifest.json` version matches `package.json`
3. [ ] Icons regenerated and present at all four sizes (`npm run icons`)
4. [ ] **COMPLIANCE.md re-audited** — every row still true; any new permission/endpoint/data flow got an ADR + policy update
5. [ ] Clean-install test: fresh Chrome profile → Load unpacked `dist/` → full manual QA checklist (TESTING.md §3)
6. [ ] Live CDP smoke: all checks green (TESTING.md §2)
7. [ ] No console errors in the service worker or popup during QA
8. [ ] Security review: `npm test` includes security invariants; confirm no new permissions in manifest
9. [ ] Pricing registry: verify entries against official provider pricing pages; bump `PRICING_VERSION` if changed
10. [ ] Privacy policy URL still live and current; store disclosure answers (§6) still accurate
11. [ ] Update TASK_TRACKING.md verification evidence

## 4. Packaging

```bash
cd dist && zip -r ../ai-keychain-$(node -p "require('../package.json').version").zip . -x ".*"
```

Upload the zip to the Chrome Web Store developer dashboard. Store listing assets: name, description (README §features), 128px icon (`dist/icons/icon128.png`), screenshots of the popup dashboard (light + populated states).

## 5. Web Store compliance notes

Full policy-by-policy audit: **COMPLIANCE.md** (re-verify before every publish). Privacy policy text to host: **PRIVACY_POLICY.md**.

- **Single purpose** (paste into the listing): *Securely store your AI/API credentials locally with encrypted vault technology, test them against their providers, and see private, on-device usage, cost and insight analytics.*
- **Permission justifications** (paste per-permission in the dashboard):
  - `storage` — "Stores your encrypted credential vault, your settings, and your local usage analytics on your device. Nothing is synced or sent to us."
  - `https://api.openai.com/*` (and each other host) — "When you click 'Send test request', your selected API key is sent directly over HTTPS from your browser to this provider's official API so you can verify the credential works. The request goes only to the provider you chose."
- **No remote code**: all logic ships in the package; React is bundled.
- **Data-in-transit transparency**: the only network calls ever made are the user-initiated test requests to the four declared provider hosts.

## 6. Store "Privacy practices" tab — recommended answers

| Store question | Answer | Rationale |
| --- | --- | --- |
| Does this item collect or use user data? | **No user data is collected or transmitted to the developer or third parties.** | All data is local-only; the sole egress is the user-initiated provider test call to the provider itself (disclose this sentence in the notes). |
| Personal data categories collected (PII, health, financial, auth, communications, location, history, activity, content) | None transmitted off-device. Locally stored items to mention in notes: authentication data (API keys, encrypted, local-only), usage metadata (local-only). | The store form concerns collection; local-only storage is disclosed in the notes and the privacy policy. |
| Is data sold to third parties? | No | Policy + code (no egress path exists). |
| Is data used for unrelated purposes / creditworthiness / lending? | No | Policy + code. |
| Is data used to train machine-learning / AI models? | No | Policy + code. |
| License data (Pro) | License key + device instance id sent to Dodo Payments' license service on activation and lazy re-validation (>7 days). Disclose in notes; link Dodo privacy policy. | DECISIONS/monetization.md |
| Privacy policy URL | Required — host PRIVACY_POLICY.md verbatim at a public URL. | Mandatory for items that handle user data. |
| Data retention | Until the user deletes it (in-product controls: per-item delete, Clear analytics, Delete all data, uninstall). | SECURITY.md §5. |

## 7. Post-release

- Monitor nothing (no telemetry). User-reported issues only.
- Pricing drift: the registry stamps `pricingVersion` on every event; historical estimates remain reproducible and are never silently rewritten (DECISIONS/cost-engine.md).
- For V1.0.x patches: fix, bump version in both manifests, re-run §3.
