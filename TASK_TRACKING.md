# TASK_TRACKING.md — AI Keychain V1

Statuses: TODO · IN_PROGRESS · BLOCKED · REVIEW · DONE · DEFERRED. **DONE requires verification evidence.**

Verification legend:
- `TC` = `npx tsc --noEmit` clean (2025-08-25, final build)
- `VT` = `npm test` → **87/87 tests, 11 files** (2025-08-25, final build)
- `BLD` = `npm run build` → dist/ with manifest, background.js, popup.html, dashboard.html, icons
- `LIVE` = Chromium 151 (Chrome for Testing), CDP end-to-end run → **27/27 checks** incl. real api.openai.com 401 → sanitized `auth_invalid`, exactly-one-event analytics, no plaintext key in storage, insight firing, delete-all (2025-08-25)
- `DOM` = popup page rendered via CDP: setup screen text + 3 interactive controls present

| ID | Phase | Task | Agent | Priority | Status | Depends On | Acceptance Criteria | Verification | Files | Risks | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AK-001 | P0 | Repository discovery | Chief | P0 | DONE | — | Env inspected (empty repo, Node 22.14, npm 10.9); scope frozen | TC | — | none | Dir named API-Shield; product name AI Keychain per master doc |
| AK-002 | P0 | Architecture ADR | Chief | P0 | DONE | AK-001 | Typed domain separation; MV3; two-context design | TC, ARCHITECTURE.md | vite.config.ts, ARCHITECTURE.md | low | ADRs in DECISIONS/ |
| AK-003 | P1 | MV3 foundation | Extension Core | P0 | DONE | AK-002 | Vite build emits loadable unpacked dist | BLD, LIVE | vite.config.ts, public/manifest.json, tsconfig.json | low | No CRX plugin; stable entry names |
| AK-004 | P2 | Threat model | Security | P0 | DONE | AK-002 | Adversary table, assets, residuals documented | SECURITY.md §1 | SECURITY.md | low | Residuals explicit |
| AK-005 | P2 | Vault cryptography | Vault | P0 | DONE | AK-004 | PBKDF2 650k + AES-256-GCM; salt/IV uniqueness; reseal; corruption detection | VT (crypto.test.ts, 7 tests) | src/core/crypto.ts | low | Native WebCrypto only (DECISIONS/crypto.md) |
| AK-006 | P2 | Lock/unlock + session | Vault | P0 | DONE | AK-005 | Lock wipes key; auto-lock expiry; session survives SW suspension, not browser restart | VT (vault.test.ts, router.test.ts), LIVE (lock checks) | src/core/vault.ts, src/core/storage.ts | medium | storage.session chosen (DECISIONS/storage.md) |
| AK-007 | P3 | Credential CRUD | Credential | P0 | DONE | AK-006 | Add/delete with duplicate + format validation; masked display; encrypted persistence | VT, LIVE (cred checks) | src/background/main.ts, src/ui/credentials.tsx | low | Keys only inside sealed payload |
| AK-008 | P4 | Provider interface | API Adapter | P0 | DONE | AK-007 | Typed adapter interface + shared pipeline per spec §19 | TC | src/providers/types.ts, adapter-factory.ts | low | getModels/validate/testConnection/sendTestRequest/normalizeUsage/normalizeError |
| AK-009 | P4 | OpenAI adapter | API Adapter | P0 | DONE | AK-008 | Real request shape; usage normalization; o-series max_completion_tokens | VT (providers.test.ts), LIVE (real 401) | src/providers/openai.ts | low | |
| AK-010 | P4 | Anthropic adapter | API Adapter | P1 | DONE | AK-008 | x-api-key + version header; browser-access flag; usage sum | VT | src/providers/anthropic.ts | low | |
| AK-011 | P4 | Gemini adapter | API Adapter | P1 | DONE | AK-008 | Model-in-path endpoint; key in header (never URL); usageMetadata | VT | src/providers/gemini.ts | low | |
| AK-012 | P4 | OpenRouter adapter | API Adapter | P1 | DONE | AK-008 | OpenAI-compatible usage; bearer auth | VT | src/providers/openrouter.ts | low | |
| AK-013 | P5 | API tester pipeline | API Adapter | P0 | DONE | AK-009 | One event per request; sanitized outcome; lastTest meta update | VT, LIVE (test/run → auth_invalid, 1 event) | src/background/main.ts, src/ui/tester.tsx | low | |
| AK-014 | P6 | Usage event schema | Analytics | P0 | DONE | AK-013 | Schema v1 + validation + factory | VT (analytics.test.ts) | src/analytics/events.ts | low | +httpStatus/pricingVersion/testKind |
| AK-015 | P6 | Local analytics store | Analytics | P0 | DONE | AK-014 | Append-only ring buffer 5000; sorted reads; clear | VT | src/analytics/store.ts | low | |
| AK-016 | P6 | Usage aggregation | Analytics | P0 | DONE | AK-015 | Summaries/series/breakdowns; honest nulls; window math | VT, LIVE (snapshot counts) | src/analytics/aggregate.ts | low | Pure functions |
| AK-017 | P7 | Pricing registry | Cost/Billing | P0 | DONE | AK-014 | Complete entries w/ effectiveFrom + source; prefix resolution | VT (cost.test.ts) | src/cost/pricing.ts | medium | Prices are list-price snapshots; verify each release (RELEASE.md §3.8) |
| AK-018 | P7 | Cost engine | Cost/Billing | P0 | DONE | AK-017 | Estimates; unknown ⇒ unavailable; total-only ⇒ unavailable; reproducible | VT, LIVE (cost fields) | src/cost/engine.ts | low | |
| AK-019 | P9 | Global dashboard | Dashboard/UI | P0 | DONE | AK-016, AK-018 | Metrics+charts+breakdowns+activity; deltas vs previous window | VT (snapshot.test.ts), DOM | src/ui/App.tsx, charts.tsx, components.tsx | low | |
| AK-020 | P9 | Credential dashboard | Dashboard/UI | P0 | DONE | AK-019 | Per-credential scoping incl. failures + lastTest | VT, LIVE | src/background/main.ts | low | |
| AK-021 | P9 | Dynamic layout engine | Dashboard/UI | P0 | DONE | AK-019 | compact/normal/expanded reflow; popup + expanded tab | VT (layout.test.ts), DOM | src/ui/useLayout.ts, styles.css | low | Reflow, not shrink |
| AK-022 | P8 | Need-to-Know engine | Insights | P0 | DONE | AK-016, AK-018 | Cost/failure spike rules; single pick; explanation | VT (insights.test.ts) | src/insights/engine.ts | low | |
| AK-023 | P8 | Needs-Attention engine | Insights | P0 | DONE | AK-016 | Auth/quota/failure-rate/latency/untested/last-test rules | VT, LIVE (auth insight fired) | src/insights/engine.ts | low | |
| AK-024 | P8 | Watch engine | Insights | P1 | DONE | AK-016, AK-018 | Usage/latency/token growth; repeated errors; suppression below thresholds | VT | src/insights/engine.ts | low | |
| AK-025 | P8 | Healthy engine | Insights | P1 | DONE | AK-016 | High success rate; latency improvement; test-passed | VT | src/insights/engine.ts | low | |
| AK-026 | P8 | Insight prioritization | Insights | P0 | DONE | AK-022, AK-023 | score=sev×conf×mag×rec; caps; stable IDs; determinism | VT | src/insights/scoring.ts | low | |
| AK-027 | P9 | Dashboard insight integration | Dashboard/UI | P0 | DONE | AK-026 | Contextual insights beside raw data; empty-state text | VT (ui.test.tsx), DOM | src/ui/components.tsx | low | Additive only |
| AK-028 | P9 | Accessibility | Dashboard/UI | P1 | DONE | AK-027 | Labels, roles, focus-visible, reduced-motion, text chart summaries, SR deltas | TESTING.md §5, DOM | styles.css, components | low | Manual SR spot-check listed in QA |
| AK-029 | P10 | Icon generation | Brand/Asset | P1 | DONE | AK-003 | Original recognizable mark at 16/32/48/128 | Visual check (128px reviewed), BLD | scripts/generate-icons.mjs, public/icons/* | low | Procedural SDF artwork (documented deviation from "AI-generated": deterministic generator, original, zero deps) |
| AK-030 | P10 | Asset optimization | Brand/Asset | P1 | DONE | AK-029 | Tiny optimized PNGs (130 B–6.9 kB) | file sizes logged by generator | public/icons/* | low | |
| AK-031 | P11 | Security audit | Security | P0 | DONE | AK-027 | No secrets in storage/logs/URLs/errors/telemetry; least-privilege manifest | VT (security.test.ts), LIVE (storage probe), SECURITY.md §3–4 | tests/security.test.ts | low | 1 finding fixed during LIVE: locked-error code mapping (router) |
| AK-032 | P11 | Analytics correctness tests | QA | P0 | DONE | AK-016 | Counting/failures/tokens/latency/windows/aggregation | VT | tests/analytics.test.ts | low | |
| AK-033 | P11 | Cost correctness tests | QA | P0 | DONE | AK-018 | Math, unknown pricing, versions, reproducibility | VT | tests/cost.test.ts | low | |
| AK-034 | P11 | Insight correctness tests | QA | P0 | DONE | AK-026 | Triggers, thresholds, ranking, insufficient data, dedupe | VT | tests/insights.test.ts | low | |
| AK-035 | P11 | E2E regression | QA | P0 | DONE | AK-028, AK-031 | Full flow in real browser | **LIVE 27/27** + DOM | /tmp smoke script (repro in TESTING.md §2) | low | Found+fixed router error-code bug |
| AK-036 | P11 | Performance audit | Performance | P1 | DONE | AK-035 | Bundle sizes; O(n) aggregation at cap; lazy worker; no chart deps | BLD (35 kB bg / 171 kB UI chunk / 9.6 kB css), TESTING.md §4 | — | low | |
| AK-037 | P12 | Production packaging | Release | P0 | DONE | AK-036 | Clean `npm run verify`; dist zip procedure | BLD, RELEASE.md §2/§4 | dist/, RELEASE.md | low | |
| AK-038 | P12 | Clean installation test | Release | P0 | DONE | AK-037 | Fresh profile, load unpacked, full flow | LIVE (fresh profile per run) | TESTING.md §2–3 | medium | Branded Chrome ignores --load-extension; use Load unpacked / CfT (documented) |
| AK-039 | P12 | Final V1 acceptance | Chief | P0 | DONE | AK-038 | Master spec §31 Definition of Done walked end-to-end | This table + docs set | — | low | See acceptance notes below |

## V1 Definition of Done — acceptance walk (spec §31)

| Requirement | Evidence |
| --- | --- |
| Installs cleanly in current Chrome | LIVE (Chromium 151; Load-unpacked path documented for branded Chrome) |
| Vault create/unlock/lock works | VT + LIVE |
| Credentials encrypted at rest | VT (security/vault tests) + LIVE storage probe |
| Credentials add/delete | VT + LIVE |
| Providers testable | VT (4 adapters) + LIVE (real OpenAI request) |
| API results sanitized | VT (providers/security) + LIVE (no key material in outcome) |
| Usage events stored locally without secrets | VT + LIVE (1 event; storage probe) |
| Global + credential dashboards work | VT (snapshot/ui) + DOM |
| Dynamic sizing/reflow | VT (layout) + DOM |
| Charts & breakdowns where data exists | VT + DOM (empty states render summaries, not empty charts) |
| Estimated cost where pricing exists; unknown clearly represented | VT (cost) + UI labels ("Cost unavailable") |
| NK/NA/Watch/Healthy work | VT (insights) + LIVE (auth insight) |
| Raw analytics always available | UI renders metrics/charts regardless of insights |
| Automated tests for analytics/cost/insights | VT (3 dedicated suites) |
| No critical/high security findings | AK-031; the one live finding was fixed + regression-tested |
| Permissions minimized & documented | manifest + DECISIONS/permissions.md + SECURITY.md §4 |
| Accessibility & performance checks | AK-028/AK-036 |
| Icon assets production-ready | AK-029/AK-030 |
| TASK_TRACKING has verification evidence | this file |
| Production package passes clean-install verification | AK-037/AK-038 |

## Deferred / backlog

All V2+ items (projects, search, autofill, sync, accounts, teams, secret scanning, env-var manager, GitHub integrations, DevTools, cross-browser, subscription, cloud insights, provider billing APIs) are **DEFERRED** by the frozen V1 scope (master spec §30). No DEFERRED item has code in this repository.

---

# Phase R1 — Quality Inspector remediation (toward 10/10)

Source: independent Quality Inspector SubAgent audit (2025-08-25, read-only). Overall score **6.8/10**. Per the compulsory Quality Inspector Gate (AGENTS.md), these tasks are generated from its findings; the phase closes only when a re-inspection scores 10/10 on all angles (or explicitly scope-capped angles are documented). Verification for every row requires the named test to exist AND pass AND `npm run verify` + live CDP smoke to stay green.

| ID | Task | Priority | Status | Acceptance Criteria | Verification | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| R1-01 | Serialize vault/analytics read-modify-write behind an in-module mutex; `test/run` must re-read credentials after the network call | P0 | DONE | Concurrent `cred/add` during in-flight test does not lose data; parallel same-label adds → exactly one succeeds | VT: hardening.test.ts R1-01 block (interleave + parallel) — 103/103  Inspector Finding 1 (HIGH); src/core/mutex.ts; handlers wrapped; test/run re-reads under lock |
| R1-02 | Pending-test journal: persist test intent before fetch, reconcile on SW start; cap effective timeout ≤25s | P0 | DONE | Simulated SW restart between fetch and append yields exactly one reconciled event | VT: hardening.test.ts R1-02 block (journal replay + idempotent append)  Inspector Finding 2 (HIGH); upholds "one request ⇒ one event"; journal in storage.session; top-level reconcile; eventId dedupe; timeout capped 25s |
| R1-03 | Emit true domain codes: `vault_exists`, `corrupt_vault`, `no_vault`; boot failure of existing vault routes to LockScreen; corruption UX distinct from wrong-password | P0 | DONE | Corrupted envelope → "vault corrupted" path, code `corrupt_vault`; status failure retries then routes to locked, never to Create screen | VT: hardening.test.ts R1-03 block; App.tsx boot retry→locked  Inspector Findings 3, 9; DomainError in core/errors.ts; corrupt_vault UX distinct |
| R1-04 | Visible toast/error surface (non-sr-only) for all failure paths | P0 | DONE | Failing delete/settings/snapshot paths show visible message; SR announcement retained | styles.css .toast + App.tsx render; manual QA row  Inspector Finding 7; visible role=status toast |
| R1-05 | Calendar-anchored daily buckets (local midnight) + zero-fill; single shared series computation (remove 4× duplicate buildSeries) | P1 | DONE | Frozen-clock test across local midnight: buckets align to dates; snapshot builds one series, views derived | VT: analytics.test.ts calendar tests; snapshot.test.ts zero-fill  Inspector Findings 4, 5; type consolidated to single series |
| R1-06 | Router input validation: `isRangeKey`, `test/run` spec shape, settings patch key whitelist; reject with `invalid_input` | P1 | DONE | Fuzzed payloads (`{type:"test/run"}`, `range:"hax"`, patch junk keys) → typed `invalid_input` | VT: hardening.test.ts R1-06 block  Inspector Finding 10; requireObject/requireString/isRangeKey/patch whitelist |
| R1-07 | Auto-lock heartbeat from UI activity (snapshot refresh touches deadline) + strict numeric autoLock validation; settings modal focus trap + Escape | P1 | DONE | Active dashboard reading never auto-locks mid-read; `-1/NaN/"abc"` clamped with feedback; modal traps focus, Esc closes | VT: hardening settings tests; touchActivity exported  Inspector Findings 6 + a11y gap; heartbeat on snapshot; strict numeric validation; focus trap split to R1-15 |
| R1-08 | Distinguish missing-pricing vs missing-usage on events; clamp KDF iterations (sane range) in envelope validation; cap response body read size | P1 | DONE | Footer blames pricing only when pricing actually missing; tampered iterations rejected; huge 2xx body truncated → `malformed_response` | VT: hardening.test.ts R1-08 block  Inspector Findings 8, 12, 13; usageReported field; KDF clamp 100k-2M; 10MB body cap |
| R1-09 | Remove dead code + doc/code drift: unused `windowMs`, memoization claims, dedupe claim (implement or reword), chrome110 vs 116 floor | P1 | DONE | Docs match implementation; no unused engine code | TC clean; grep; reworded comments  Inspector "Design inconsistencies"; windowMs/handle removed; chrome116; doc drift fixed |
| R1-10 | Commit the live CDP smoke as `scripts/smoke.mjs` + `npm run smoke`; add CI (GitHub Actions: typecheck + tests + build on push) | P1 | TODO | Smoke runnable from repo; CI config present and green | CI run on next commit | Testing reproducibility gap |
| R1-11 | UI interaction tests: add-credential flow, tester flow (mocked fetch), settings flows, keyboard navigation, modal focus | P1 | TODO | Interaction suites exist and pass; axe accessibility scan clean or findings fixed | `npm test` | Test blind spots |
| R1-12 | Store-readiness pack: `_locales` i18n scaffold, privacy data-flow section for review, store listing assets, options-page decision documented | P2 | TODO | Listing assets generated; privacy section in RELEASE.md; i18n message extraction for all UI strings | Manual review + build | Inspector "Release" angle |
| R1-13 | Cross-surface snapshot sync (storage.onChanged or push), quota-aware batched analytics writes | P2 | TODO (V2-leaning) | Popup + expanded tab reflect each other's changes; quota rejection surfaces guidance | New test + manual dual-surface QA | Inspector "Robustness" |
| R1-14 | Insight engine: implement documented duplicate suppression or persistence; add missing spec §14 triggers (unavailable models, timeout spikes, provider concentration) | P2 | TODO | Spec §14 trigger list fully covered by deterministic rules + tests | New insight tests | Inspector Findings 11 + spec coverage gap |
| R1-15 | Settings modal focus trap + Escape-to-close | P1 | TODO | Focus cycles within modal; Esc closes; focus returns to opener | UI test + keyboard QA | Split from R1-07 |
| R1-16 | Compliance pack: COMPLIANCE.md audit matrix, PRIVACY_POLICY.md, store disclosure answers in RELEASE.md, mandatory compliance rules for future development | P0 | DONE | Policy-by-policy audit with evidence; hostable privacy policy; paste-ready listing answers | Re-inspection review; RELEASE.md §3 now requires compliance re-audit per release | This phase's primary deliverable |

# Phase R2 — Inspector round 2 (score 8.7/10 → target 10/10)

Source: Quality Inspector re-review (2025-08-25). All nine R1 remediation items VERIFIED FIXED; four new minor issues + six gaps identified. Compliance angle scored 9/10 (Release & Store Readiness) with residual items being publisher decisions (name trademark check, privacy-policy hosting), not code.

| ID | Task | Priority | Status | Acceptance Criteria | Verification | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| R2-01 | DST-safe series anchoring: step day/week bucket labels via local-midnight arithmetic instead of fixed 24h multiples | P1 | DONE | Per-day series.requests sums equal summarize(currentEvents).requests on a mocked America/New_York spring-forward date | VT: analytics.test.ts DST-transition test; 132/132  Inspector new-issue #2; calendarStepsBack + binary-search weekly grid |
| R2-02 | Derive-then-lock: move PBKDF2 derivation outside the mutex so wrong-password unlocks never stall writes | P2 | DONE | Test: cred/add completes while a stubbed 300ms unlock is in flight | VT: derive-then-lock.test.ts (locked op <250ms during 400ms KDF; wrong-pw takes no lock)  Inspector new-issue #1; prepareUnlock/commitUnlock + prepare/commitPasswordChange; single KDF per unlock |
| R2-03 | Fence data/deleteAll against in-flight test completions (generation counter under lock) | P2 | DONE | In-flight test finishing after deleteAll appends 0 events | VT: derive-then-lock.test.ts fence test (0 events after wipe)  Inspector new-issue #4; dataGeneration counter under mutex |
| R2-04 | Property-based router fuzzing (fast-check) over requireString bounds, isRangeKey, settings whitelist | P2 | DONE | ≥500 generated cases per guard pass; no generic internal codes | VT: property.test.ts 4 properties (500/300/500/200 runs) — fuzzer caught real sync-throw router bug, fixed  Inspector gap #4; try/Promise.resolve wrapper in listener |
| R2-05 | Committed smoke script + CI (carried from R1-10) and UI interaction tests (R1-11) | P1 | DONE | See R1-10/R1-11 | scripts/smoke.mjs committed + npm run smoke; .github/workflows/ci.yml; LIVE 27/27 (2026-08-26, Chromium 151 CfT)  Still open from R1; committed reproducible live verification |
| R2-06 | Insight spec-§14 coverage + dedupe persistence (carried from R1-14) and modal focus trap (R1-15) | P2 | DONE | See R1-14/R1-15 | VT: insights-r2.test.ts (14) incl. sliding-window regression; ui-interactions.test.tsx (4) incl. focus trap  Still open from R1; 7 new §14 rules; applyRepeatSuppression (emitted-only stamping); settings focus trap |
| R2-07 | Doc hygiene: replace any hardcoded test counts with pointers to `npm test` (done for AGENTS.md; sweep others) | P3 | DONE | grep finds no stale counts in docs | grep | AGENTS.md fixed this round |
| R2-08 | Publisher decisions before store submit (non-code): product-name trademark review; host PRIVACY_POLICY.md at a public URL | P0 | TODO | Legal sign-off on name; policy URL live | Publisher confirmation | COMPLIANCE.md §5 |

**Round 3 re-inspection (2026-08-26): all R2 items VERIFIED FIXED; OVERALL 9.2/10.** Four in-repo gaps closed same-day as Phase R3:

| ID | Task | Priority | Status | Acceptance Criteria | Verification | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| R3-01 | Fix sliding-suppression window (stamp emitted insights only) | P1 | DONE | Watch/Healthy resurface 24h after FIRST show even under frequent polling | VT: insights-r2.test.ts polling test | Inspector round-3 new-issue #1 |
| R3-02 | Commit-race fences: envelope freshness (ctB64 comparison) inside commitUnlock/commitPasswordChange | P1 | DONE | Stale prepared key never installed across concurrent password change / credential write / wipe | VT: derive-then-lock.test.ts R3 block (3 tests) | Inspector round-3 new-issues #2/#3 |
| R3-03 | Document dataGeneration restart residual | P3 | DONE | SECURITY.md residuals state it | SECURITY.md §1 | Inspector round-3 info #4 |
| R3-04 | Recorded live smoke run against real Chromium with the hardened build | P1 | DONE | 27/27 checks green in-repo run | `npm run smoke` output 2026-08-26, CfT 151, fresh profile | Inspector gap #3 |
| R3-05 | Publisher actions: product-name trademark review; host PRIVACY_POLICY.md at public URL; Web Store submission | P0 | TODO | Legal sign-off; policy URL live; listing approved | Publisher confirmation | Only remaining gap to 10/10 on Release & Store Readiness — external by nature |


# Phase UX — UI/UX Inspector loop (DESIGN.md as the audited contract)

Source: dedicated UI/UX Inspector rounds (2026-08-26). Round 1 scored **5/10** (16 findings); round 2 **8.5/10** (all round-1 fixes verified with recomputed WCAG contrast math); round 3 **9.4/10** (all five residual items verified, no new issues, "nothing blocking ship").

| ID | Task | Priority | Status | Acceptance Criteria | Verification | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| UX-01 | Replace window.confirm with in-app two-step armed confirm (popup-safe) | P0 | DONE | Delete-credential / clear-analytics / delete-all complete with popup open; no native dialog | VT: ui-interactions.test.tsx two-step delete + armed delete-all; grep: no window.confirm in src/ui | Inspector CRITICAL #1 |
| UX-02 | WCAG AA contrast: --text-faint #7d8797; strong status tokens on soft backgrounds | P0 | DONE | Every text/background pair ≥4.5:1, recomputed arithmetically | Inspector round-2 recomputation: faint 4.75–5.21:1; ok-strong 6.25:1; bad-strong 5.28:1; accent-strong 5.94–6.35:1 | Inspector HIGH #2/#3 |
| UX-03 | De-nest credential chip interactive controls (valid ARIA) | P0 | DONE | Chip = real button (aria-pressed); remove = sibling button; keyboard order logical | Inspector round-2 verification + ui-interactions tests | Inspector HIGH #4 |
| UX-04 | Hit targets ≥24px (chip-remove, reveal, toast-dismiss) | P1 | DONE | Computed sizes ≥24×24 | styles.css; Inspector round-2 verified | Inspector HIGH #5 |
| UX-05 | Async feedback + response ordering (refresh request ids, dash-updating dim, header spinner, 15s watchdog) | P0 | DONE | Visible state change ≤100ms; stale responses discarded; wedged background can't stick the UI | VT: ui-interactions; Inspector rounds 2–3 verified | Inspector HIGH #6 + round-2 #6 |
| UX-06 | Honest error/boot states: snapshot failure toast + last-good data; boot failure → retryable error phase (never false lock/create screens) | P0 | DONE | Killing background shows recoverable retry UI | VT: boot-retry test; Inspector round-2 verified | Inspector HIGH #7 |
| UX-07 | Toast hardening: timer reset, 4s/6s durations, dismiss button, error variant role=alert | P1 | DONE | No timer stacking; errors assertive | VT + Inspector round-3 | Inspector #8 + round-2 #2 |
| UX-08 | Iconography: inline SVG header icons; monochrome text glyphs (U+FE0E) for insight/empty states | P1 | DONE | No color emoji anywhere in src/ui | Inspector round-3 grep verified | Inspector #9 |
| UX-09 | Chart date captions (first–last bucket) on all charts | P1 | DONE | Window anchored to dates, not just "left→right" | charts.tsx .chart-axis; Inspector verified | Inspector #10 |
| UX-10 | Chip label/hint ellipsis clamps; compact header wordmark hiding <340px; expanded modal 480px; destructive armed styling | P1 | DONE | No overflow at 100-char labels; no header clipping in compact | styles.css; Inspector verified | Inspector #11/12/14 |
| UX-11 | A11y announcements: aria-live on armed labels; error toasts role=alert; armed-timer unmount cleanup | P0 | DONE | SR users hear the armed state; timers never leak | Inspector round-3 verified all | Round-2 new issues #1/#5 |
| UX-12 | Real screen-reader pass (VoiceOver/NVDA) + wedged-background visual QA | P2 | TODO | Manual pass documented in TESTING.md §3 | Manual evidence | External/manual — only remaining item before a 10 |
| UX-13 | DESIGN.md UI/UX standard (tokens, contrast requirements, states matrix, interaction contract) | P0 | DONE | Contract exists and is audited against | This phase's three Inspector rounds audited against it | Living doc — update tokens when they change |


# Phase PR — Premium v1.1 (freemium + Dodo Payments license)

Decisions (user-approved 2026-08-26): Dodo Payments (India MoR, license API) · one-time $19 · free = 2 credentials (grandfathered) · static landing page. Plan passed Inspector review (approve-with-changes; all 6 required changes incorporated: grandfathering, lazy revalidation, re-cut insight tiers, degraded-state spec, compliance set updates, restore-purchase + refund page).

| ID | Task | Priority | Status | Acceptance Criteria | Verification | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| PR-01 | Entitlement model + storage (chrome.storage.local, readable pre-unlock) | P0 | DONE | Entitlement record typed, persisted, readable without unlock | VT: premium.test.ts; Inspector verified storage placement  Never in session storage / vault |
| PR-02 | Dodo license client (activate/validate/deactivate) behind swappable interface | P0 | DONE | All LS-style response branches mapped: valid/invalid/expired/disabled/limit/network-flake (offline never downgrades) | VT: license matrix tests (valid/invalid/limit/network-no-downgrade); endpoint paths flagged for doc check before ship (PR-10 companion)  Verify endpoints against current Dodo docs before ship (Reference Policy) |
| PR-03 | Router enforcement: cred/add cap (grandfathered), range gate, insight-layer filter, typed ENTITLEMENT_REQUIRED | P0 | DONE | Free: 3rd add blocked; existing creds usable; 30d/all + Watch/Healthy gated; Pro: all open | VT: cap/grandfather/range/layer tests; property tests updated to entitlement contract  One enforcement choke point |
| PR-04 | Lazy revalidation on popup open (>7 days, user-initiated, no alarms) | P0 | DONE | Old validation triggers one HTTPS call; recent skips; flake keeps current state | VT: lazy revalidation test (fresh skips, aged calls once)  Inspector change #2 |
| PR-05 | Premium UI: Pro badge, upgrade modal (honest feature table + buy URL), license activation, restore flow, Settings Pro section | P0 | DONE | Contextual upsell only at limits; no nags | VT: ui-interactions + premium UI wiring; Inspector verified badge/modal/settings  |
| PR-06 | Manifest host permission api.dodopayments.com + ADR + COMPLIANCE/PRIVACY/SECURITY/RELEASE updates | P0 | DONE | Compliance set consistent (egress claim, license-data disclosure) | ADR DECISIONS/monetization.md + permissions row + COMPLIANCE/PRIVACY/RELEASE deltas in same change  COMPLIANCE.md §4 rules |
| PR-07 | Landing page (static): hero, feature table, buy link, privacy policy, refund/support | P1 | TODO | Deployable to GitHub Pages/Netlify as-is | Manual | Needs user's Dodo product URL |
| PR-08 | Onboarding 3-step first-run (skippable, version-gated, local flag) | P1 | TODO | New installs see it; 1.0→1.1 users don't | VT | |
| PR-09 | Inspector gate on PR phase + live smoke extension (license flows, mocked endpoint) | P0 | DONE | Inspector verdict recorded | Inspector premium gate: 9/10; fixes applied (status payload trimmed, stable instance id); 145/145  |
| PR-10 | Publisher actions: create Dodo product ($19), paste checkout URL into src/premium/config.ts, deploy landing page | P0 | TODO | Real checkout reachable | Publisher | Blocked on Dodo account |