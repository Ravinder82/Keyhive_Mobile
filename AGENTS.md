# AGENTS.md — Working Rules for AI Agents on AI Keychain

This repository was built agent-first (see TASK_TRACKING.md for the agent board). Any agent — human or AI — working here MUST follow these rules.

## ⏱ RATE-LIMIT PACING (mandatory operational rule)

**Never send requests too quickly.** If a "sending requests too quickly / try again later" warning appears at any point, it means the pacing was violated — treat it as a hard stop signal.

- Space out tool calls: no large bursts of parallel calls; prefer sequential batches with a pause between them.
- After any rate-limit warning, wait before the next call and reduce burst size for the remainder of the session.
- Long-running work must be chunked into smaller verified steps rather than many rapid-fire calls.
- This rule applies to subagents too: inspectors and reviewers must pace their reads and commands.

## ⛔ QUALITY INSPECTOR GATE (compulsory — supersedes convenience)

**Canonical system: [`INSPECTOR.md`](INSPECTOR.md)** — the portable, full enforcement file (roles, brutal scoring rubric, evidence ladder, gate, hard-fail triggers, self-improvement ledger). The rules below are its summary; where they differ, INSPECTOR.md wins.

**After EVERY completed task, a dedicated SubAgent ("Quality Inspector") MUST review the work before it can be marked DONE.** The implementing agent may not self-approve. Gate: OVERALL ≥ 9.0, no angle < 8.5, zero open CRITICAL/HIGH findings.

Inspector mandate — find and report:
1. **Gaps** — spec requirements not met, acceptance criteria unverified, missing tests/docs.
2. **Issues** — bugs, race conditions, error paths unhandled, security weaknesses.
3. **Design inconsistencies** — deviations from ARCHITECTURE.md/DECISIONS/, layer violations, naming/idiom drift.
4. **Robustness** — how the feature fails under bad input, storage corruption, network loss, SW suspension, huge data.
5. **Next phase** — a concrete, prioritized improvement list feeding the NEXT task batch.

Scoring: the Inspector rates the work 0–10 on each expert angle — Security & Privacy, Correctness & Functionality, Architecture & Code Quality, Testing & QA, UI/UX & Design, Accessibility, Performance, Release/Store Readiness, Documentation, Maintainability & Robustness.

**Loop rule: new improvement tasks are generated and executed until the Inspector scores 10/10 on ALL angles.** An angle may be closed at 10 only with evidence (test, artifact, or live check) — not assertion. If an angle is genuinely capped by V1 frozen scope, the Inspector must say so explicitly and score the *execution within scope*; the residual moves to the V2 backlog, not to silent debt.

Process: implement → self-verify (`npm run verify`) → spawn Inspector SubAgent with a read-only mandate → fix findings or file them as tasks → Inspector re-reviews → only then DONE.

## Prime directives

1. **Security over features.** If security, privacy, correctness, platform constraints or scope conflict with a feature: STOP, document the decision in `DECISIONS/`, then continue.
2. **V1 scope is frozen.** No projects, folders, search, tags, autofill, sync, accounts, teams, prompt/completion history or unrelated features. The V2+ backlog lives in the master spec and must not leak into V1 work.
3. **Never mark DONE without evidence.** Every `DONE` in TASK_TRACKING.md carries a Verification column entry: a passing test name, build artifact, or live check output.
4. **No secrets, ever.** No API keys, Authorization headers, prompts, completions or provider response bodies in code, logs, tests, telemetry, error messages or analytics. This is enforced by `tests/security.test.ts` — keep it that way.
5. **Never fabricate data.** Unknown pricing ⇒ "Cost unavailable". Insufficient history ⇒ no trend/insight. Missing metrics ⇒ "—", not zero.

## Commands

```bash
npm run verify   # typecheck + tests + production build — run before every handoff
npm test         # full Vitest suite (run `npm test` for the live count; do not
                 # hardcode it in docs — this file was corrected 2025-08-25)
npm run icons    # regenerate public/icons/*.png (procedural, deterministic)
```

After changing `dist/` content, reload the extension in Chrome (chrome://extensions → ↻) — MV3 service workers cache the loaded code until restart/reload.

## Architecture map

| Layer | Location | Rules |
| --- | --- | --- |
| Shared domain types | `src/shared/types.ts` | Single source of truth. Message protocol (`BgRequest`/`BgResponse`) lives here. |
| Crypto | `src/core/crypto.ts` | Native WebCrypto only. No third-party crypto dependencies without a new ADR. |
| Vault lifecycle | `src/core/vault.ts` | Runs ONLY in the background service worker. |
| Storage | `src/core/storage.ts` | All keys registered in `STORAGE_KEYS`. UI never imports this. |
| Providers | `src/providers/*` | All provider HTTP goes through `runStandardPipeline`; errors through `sanitize.ts`. UI must not contain provider request logic. |
| Analytics | `src/analytics/*` | Pure aggregation functions; append-only capped store. |
| Cost | `src/cost/*` | Registry entries require effectiveFrom + source. Engine returns `undefined` (never a guess) when pricing is unknown. |
| Insights | `src/insights/*` | Deterministic rules only. Stable IDs. Additive to raw metrics. |
| Background | `src/background/main.ts` | The only privileged context. Message router + handlers. |
| UI | `src/ui/*` | React. Communicates ONLY via `sendToBackground()`. No storage, no fetch, no provider logic. |

## Conventions

- TypeScript strict; `tsc --noEmit` must stay clean.
- Tests colocated in `tests/`; every engine module (crypto, vault, providers, analytics, cost, insights, router, security invariants) has a suite. New engine code requires a new suite.
- One provider request ⇒ exactly one usage event. Retries are not modeled in V1.
- Error responses use `ErrorCode` from `shared/types.ts`; map lifecycle errors (`LockedError`, `WrongPasswordError`) centrally in the router catch.
- Icons are generated, not hand-edited. Change `scripts/generate-icons.mjs`, run `npm run icons`, commit the PNGs.
- Docs live with the code: update ARCHITECTURE.md/SECURITY.md in the same change when behavior shifts.

## Verification ladder (what "verified" means)

1. `tsc --noEmit` clean
2. `npm test` green (includes security invariants)
3. `npm run build` produces `dist/` with manifest + icons + background.js + popup.html
4. Live check: load `dist/` unpacked in Chromium/Chrome-for-testing and run the CDP smoke script (see TESTING.md §Live verification) — 27/27 checks
5. Only then may TASK_TRACKING rows move to DONE.

## Known platform gotchas

- Branded Chrome ≥137 ignores `--load-extension`. Use "Load unpacked" or Chrome for Testing/Chromium.
- MV3 service workers suspend after ~30s idle; session state must live in `chrome.storage.session` (memory-backed) — see DECISIONS/storage.md.
- Anthropic requires `anthropic-dangerous-direct-browser-access: true` for direct browser calls.
- Gemini's REST path embeds the model name; keys go in the `x-goog-api-key` header, never the URL.
