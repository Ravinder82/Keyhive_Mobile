# ARCHITECTURE.md

## 1. Overview

AI Keychain is a Chrome Manifest V3 extension with a strict two-context design:

- **Background service worker** (`src/background/main.ts`) — the only privileged context. Owns vault operations, credential CRUD, provider HTTP, analytics persistence and insight generation.
- **UI pages** (`src/ui/`) — React app rendered in the action popup (`popup.html`) and an expanded dashboard tab (`dashboard.html`). Pure view layer: it communicates exclusively through typed messages and never touches `chrome.storage`, provider APIs or crypto.

```
┌──────────────┐   BgRequest/BgResponse    ┌─────────────────────────────┐
│ popup.html   │ ─────────────────────────▶│ service worker (background) │
│ dashboard    │   chrome.runtime.sendMessage│  ├─ vault (crypto+session) │
│ (React)      │ ◀─────────────────────────│  ├─ providers (HTTPS direct)│
└──────────────┘                           │  ├─ analytics store         │
                                           │  ├─ cost engine             │
                                           │  └─ insights engine         │
                                           └───────────┬─────────────────┘
                                                       │
                                    chrome.storage.local (vault envelope,
                                    settings, analytics events — no secrets)
                                    chrome.storage.session (derived key,
                                    memory-backed, browser lifetime)
```

## 2. Module map

| Module | Responsibility |
| --- | --- |
| `src/shared/types.ts` | All domain types + `BgRequest`/`BgResponse` protocol + formatting helpers |
| `src/core/crypto.ts` | PBKDF2 key derivation, AES-256-GCM seal/open, envelope versioning |
| `src/core/vault.ts` | create/unlock/lock/changePassword, credential read/write, auto-lock |
| `src/core/storage.ts` | `KVDriver` over chrome.storage.local/session (+ test memory driver), key registry |
| `src/providers/types.ts` | `ProviderAdapter` interface + shared request pipeline |
| `src/providers/adapter-factory.ts` | Common adapter construction (models, key validation, error mapping) |
| `src/providers/{openai,anthropic,gemini,openrouter}.ts` | Endpoint/headers/body/usage normalization per provider |
| `src/providers/sanitize.ts` | HTTP status / transport failure → fixed category + static message |
| `src/analytics/events.ts` | Usage event schema v1, event factory, defensive validation |
| `src/analytics/store.ts` | Append-only ring buffer (5000 events) over storage.local |
| `src/analytics/aggregate.ts` | summarize / buildSeries / breakdown / recentActivity (pure functions) |
| `src/cost/pricing.ts` | Versioned pricing registry (effectiveFrom, source, per-1M USD) |
| `src/cost/engine.ts` | usage × pricing → estimate, or `undefined` when unknown |
| `src/insights/scoring.ts` | score = severity × confidence × magnitude × recency |
| `src/insights/engine.ts` | Deterministic rules for all four layers, selection, capping, stable IDs |
| `src/background/main.ts` | Message router, handlers, dashboard snapshot builder |
| `src/ui/*` | React components: dashboard, charts, credentials, tester, settings, layout engine |

## 3. Runtime data flows

**Credential use (test request):**
```
User → popup: test/run{credentialId, model}
  → SW: readCredentials() (session key decrypts envelope in memory)
  → adapter.sendTestRequest(): HTTPS directly to provider (host_permissions, no proxy)
  → outcome: {ok, latencyMs, usage?, cost?, error?{category,message,httpStatus}}
  → exactly ONE UsageEvent appended to analytics store
  → credential.lastTest meta updated (inside encrypted vault)
  → sanitized outcome returned to popup
```

**Insights:**
```
Provider response → sanitized usage metadata → UsageEvent → analytics store
  → dashboard/snapshot: in-window + previous-window aggregation
  → cost engine (at request time, stamped on the event)
  → insights engine (deterministic rules, scoring, dedupe, cap)
  → DashboardSnapshot {global, credential?, insights, credentials, settings}
```

## 4. Message protocol

All requests are `BgRequest` (see `src/shared/types.ts`); all responses are `{ok:true,data}|{ok:false,code,message}`. Error codes: `locked | wrong_password | weak_password | vault_exists | no_vault | not_found | duplicate_label | invalid_input | provider_error | internal | corrupt_vault`. Lifecycle errors (`LockedError`, `WrongPasswordError`) are mapped centrally in the router.

## 5. Dashboard snapshot

One message (`dashboard/snapshot`) returns everything the UI needs for a context (global or per-credential): summary + previous-window summary (for deltas), usage/cost/failure/latency series, provider/model breakdowns, recent activity, credentials list, settings and the contextual insight list. Aggregation is recomputed per snapshot over ≤5000 small events (sub-millisecond in practice) and memoization is unnecessary at V1 volume (see PERFORMANCE in TESTING.md).

## 6. Layout engine

`useLayout` (src/ui/useLayout.ts) measures viewport and picks `compact | normal | expanded`:
- `compact` (<340w or <420h): 2-column metrics, single-column charts
- `normal` (default popup ~400×600): 3-column metrics, 2-column charts
- `expanded` (≥700w ∧ ≥560h, the dashboard tab): 6-column metrics, 4-column charts, two-pane layout

CSS classes reflow the grid — content is never shrunk below readability and empty charts are never rendered (text summaries instead).

## 7. Build

Vite 6, no CRX plugin. Two page inputs (`popup.html`, `dashboard.html`) + the service worker entry; entry chunks are emitted unhashed (`[name].js`) so `manifest.json` references stay stable. `public/` (manifest + icons) is copied to `dist/` by a tiny plugin. Target: `chrome110`. Bundle: ~35 kB background, ~171 kB shared UI chunk (React), 9.6 kB CSS.

## 8. Extension points (post-V1)

- New provider: add an adapter file + registry entry + catalog models + pricing entries + tests. No other layer changes.
- New insight rule: add a candidate in `generateInsights` with stable ID, threshold, explanation; add tests for trigger, suppression and ranking.
- Vault migration: bump `VaultEnvelope.v`, handle old versions in `assertEnvelopeShape` path before opening.
