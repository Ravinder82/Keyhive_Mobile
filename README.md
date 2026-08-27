# AI Keychain 🔐

**A premium, local-first Chrome extension for securely storing AI/API credentials, testing APIs, and turning sanitized usage data into cost estimates and intelligent insights.**

AI Keychain is not a generic password manager. It is a security-first developer utility with three connected jobs:

| Layer | Purpose |
| --- | --- |
| 🔐 **Keychain** | Securely store and manage AI/API credentials — encrypted locally with your master password. |
| 🧪 **API Tester** | Verify saved credentials with real provider requests; measure latency; get sanitized errors. |
| 📊 **API Command Center** | Usage, performance, estimated cost, and four layers of prioritized, explainable insights. |

Core philosophy: **show the data, tell the user what matters, let the user investigate.** Insights never hide or replace raw analytics.

---

## Features

- **Encrypted vault** — PBKDF2-SHA-256 (650k iterations) + AES-256-GCM via native WebCrypto. Unique random salt per vault, fresh IV per encryption. The master password is never persisted; the derived key lives only in memory-backed `chrome.storage.session`.
- **Credential manager** — add/delete API keys for OpenAI, Anthropic, Google Gemini and OpenRouter with masked display (`sk-…9f2a`), duplicate detection and provider key-format validation.
- **API tester** — one click sends a real HTTPS request *directly from your browser to the provider* (no proxy server). Results show status, latency, token usage, estimated cost, and sanitized error categories. Provider response bodies are never displayed or stored.
- **Dynamic dashboard** — global analytics when no credential is selected; per-credential analytics when one is. Compact / Normal / Expanded layouts reflow (they don't just shrink). Range selector: 24h / 7d / 30d / All.
- **Estimated cost** — versioned pricing registry with effective dates and sources. When pricing is unknown, AI Keychain says **"Cost unavailable"** — it never fabricates numbers. Estimates are labeled as estimates, never as provider invoices.
- **Four insight layers** — ★ Need to Know, ⚠ Needs Attention, 👁 Watch, ✓ Healthy. Deterministic, explainable rules with severity × confidence × magnitude × recency scoring, stable IDs, duplicate suppression and insufficient-data guards.
- **Local-first privacy** — no accounts, no sync, no server, no telemetry. Analytics contain metadata only (status, latency, tokens, cost estimate) — never keys, headers, prompts or completions.

## Install (from this repository)

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run verify        # typecheck + full automated test suite + production build
```

Then load the built extension:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the `dist/` folder
4. Pin **AI Keychain** from the toolbar and click the icon

> Note: current stable branded Chrome ignores the `--load-extension` command-line flag; use **Load unpacked**. Chrome for Testing / Chromium builds accept the flag.

## Using AI Keychain

1. **Create your keychain** — choose a master password (min 8 chars). There is no recovery by design.
2. **Add a key** — pick a provider, give it a label, paste the API key. It is encrypted before it touches storage.
3. **Test it** — select the credential, pick a model, hit *Send test request*. The first test also produces your first analytics event.
4. **Watch the dashboard** — usage, latency, estimated spend, provider/model breakdowns, and the four insight layers build up as you test.
5. **Lock it** — the 🔒 button wipes the decryption key from memory immediately (auto-lock is configurable in ⚙ Settings).

## Repository layout

```
public/manifest.json        MV3 manifest (permissions: storage + 4 provider hosts)
scripts/generate-icons.mjs  Procedural original icon artwork (zero deps)
src/core/                   crypto, vault lifecycle, storage, ids
src/providers/              typed adapters (OpenAI/Anthropic/Gemini/OpenRouter), sanitization
src/analytics/              usage event schema, local store, aggregation
src/cost/                   pricing registry + estimate engine
src/insights/               scoring + four-layer rule engine
src/background/             MV3 service worker: message router + privileged pipeline
src/ui/                     React popup + expanded dashboard tab
tests/                      Vitest suites incl. security invariants + live-flow mocks
DECISIONS/                  ADRs: crypto, storage, permissions, analytics, cost, insights
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` / `build:watch` | Rebuild `dist/` on change (reload the extension in Chrome to pick it up) |
| `npm test` | Run the Vitest suite |
| `npm run typecheck` | TypeScript strict check |
| `npm run icons` | Regenerate icon PNGs |
| `npm run verify` | typecheck + tests + production build |

## Documentation

- [USER_GUIDE.md](USER_GUIDE.md) — the complete user manual: install, operate, demo, troubleshoot
- [ARCHITECTURE.md](ARCHITECTURE.md) — modules, data flow, message protocol
- [DESIGN.md](DESIGN.md) — UI/UX standard: tokens, contrast requirements, states matrix
- [SECURITY.md](SECURITY.md) — threat model, crypto specification, privacy guarantees
- [COMPLIANCE.md](COMPLIANCE.md) — Chrome Web Store & regulatory policy audit (kept current per release)
- [PRIVACY_POLICY.md](PRIVACY_POLICY.md) — store-ready privacy policy (host verbatim)
- [TESTING.md](TESTING.md) — test matrix, live-browser verification, manual QA
- [RELEASE.md](RELEASE.md) — packaging, Web Store checklist, clean-install test
- [TASK_TRACKING.md](TASK_TRACKING.md) — full task board with verification evidence
- [DECISIONS/](DECISIONS/) — architecture decision records

## License / status

V1 scope is frozen (see AGENTS.md). All cost figures are estimates computed locally from a versioned list-price registry; they are not provider invoices.
