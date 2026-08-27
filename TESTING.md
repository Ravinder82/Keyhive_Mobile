# TESTING.md

## 1. Automated suite

```bash
npm test          # full suite (run for the live count; grows with each phase)
npm run typecheck # tsc --noEmit (strict)
npm run verify    # both + production build
```

| Suite | Covers (master spec §26 matrix) |
| --- | --- |
| `tests/crypto.test.ts` | Vault: correct/wrong password, corruption, salt/IV uniqueness, password change (reseal) |
| `tests/vault.test.ts` | Vault: create/unlock/lock, auto-lock expiry, encrypted-at-rest, second-vault refusal, weak passwords |
| `tests/providers.test.ts` | API: success + usage normalization per provider; invalid key (401), rate limit (429), server error, timeout, network failure, malformed response; key-format validation; key-never-in-URL |
| `tests/analytics.test.ts` | Analytics: counting, failures, tokens, latency, time windows, provider/model aggregation, ring-buffer pruning, event validation |
| `tests/cost.test.ts` | Cost: pricing math, unknown pricing ⇒ unavailable, total-only usage refusal, reproducibility, prefix model matching |
| `tests/insights.test.ts` | Insights: triggers, thresholds, ranking, insufficient-data suppression, duplicate-suppression IDs, determinism |
| `tests/snapshot.test.ts` | Dashboard assembly: global vs credential scoping, previous-window comparison, empty state, 'all' range |
| `tests/router.test.ts` | Message routing: typed error codes (`locked`, `wrong_password`), snapshot round-trip |
| `tests/security.test.ts` | Security: no secrets in storage/events/errors, masked hints, envelope shape, locked unreadable |
| `tests/ui.test.tsx` | UI: real App render (dashboard/locked/onboarding) against mocked background |
| `tests/layout.test.ts` | UI: compact/normal/expanded layout selection |

## 2. Live verification (real browser)

Branded Chrome ≥137 ignores `--load-extension`, so use an unpacked load or an unbranded build:

```bash
npm run build
"/path/to/Chrome for Testing" --user-data-dir=/tmp/ak-test \
  --load-extension="$PWD/dist" --remote-debugging-port=9222 about:blank
npm run smoke        # scripts/smoke.mjs — drives the REAL extension over CDP
```

The committed script (`scripts/smoke.mjs`, `npm run smoke`) connects to the popup page target and evaluates `chrome.runtime.sendMessage` calls. It verifies:

1. `vault/status` → `exists:false`
2. `vault/create` (weak pw rejected, then real pw) → `unlocked:true`
3. `cred/add` (fake OpenAI key) → masked hint `sk-…`; duplicate label rejected; wrong-format Gemini key rejected pre-network
4. `vault/lock` → `cred/list` returns code `locked`; wrong password → `wrong_password`; correct password unlocks
5. `test/run` → **real HTTPS call** to `api.openai.com` with the fake key → outcome `ok:false`, category `auth_invalid`, HTTP 401, **no key material anywhere in the outcome**
6. `dashboard/snapshot` → exactly **1** request, **1** failure, recent activity `auth_invalid`, credential marked `lastTestStatus:"failure"`, and a **needs-attention insight** titled "1 authentication failure in 24 hours"
7. Credential-scoped snapshot → scoped to the selected credential
8. Storage probe → no plaintext key; `vault.envelope.v1` present
9. `settings/set` → persisted
10. `data/deleteAll` → vault gone

**Result of record (2025-08-25 build): 27/27 checks passed**, plus a DOM render check of the popup (setup screen text + interactive elements present).

## 3. Manual QA checklist (per release)

- [ ] Load `dist/` unpacked in stable Chrome — no load errors on chrome://extensions
- [ ] Create vault with a short password → rejected; with ≥8 chars → unlocks
- [ ] Reload browser → popup shows lock screen; unlock works
- [ ] Add each provider key type (or format-valid dummy) → masked hint correct
- [ ] Run a real test per provider with a valid key → success shows latency/tokens/cost
- [ ] Toolbar icon renders at 16/48 px; expanded dashboard opens in a tab
- [ ] Resize/inspect popup: compact vs normal reflow; expanded tab uses wide layout
- [ ] Keyboard: tab through header → chips → tester; Enter submits forms; Esc closes settings
- [ ] Screen reader spot check: metric cards and insight cards announce labels (aria)
- [ ] Settings: auto-lock change, password change (old data readable after), clear analytics, delete all
- [ ] Reduced-motion (OS setting) → no spinner animation

## 4. Performance notes (master spec §29)

- Popup boot = 1 `vault/status` message + 1 `dashboard/snapshot` message. Aggregation is O(n) over ≤5,000 small events per snapshot — measured negligible (<5 ms) at cap.
- Charts are hand-rolled SVG (no chart library); the UI chunk is ~54 kB gzipped including React.
- The service worker does no work while idle; it suspends between messages.
- No full-history recomputation on render: aggregation happens once per snapshot fetch, not per component render.

## 5. Accessibility

- All interactive elements are real `button`/`input`/`select` with labels (`aria-label` where textless).
- Status is conveyed by text + shape, never color alone (pills, glyphs, words).
- Charts include textual summaries with totals and orientation (`aria-label` + visible summary line).
- Visible `:focus-visible` outlines; `prefers-reduced-motion` disables the spinner.
- Delta indicators carry an SR-only "versus previous period" suffix.
