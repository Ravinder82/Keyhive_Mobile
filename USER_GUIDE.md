# AI Keychain — User Guide

*Everything you need to install, understand, test, operate, and demo the extension — written for someone who has never seen the code.*

---

## Contents

1. [What AI Keychain is](#1-what-ai-keychain-is)
2. [The 60-second mental model](#2-the-60-second-mental-model)
3. [Installing it](#3-installing-it)
4. [First run: creating your keychain](#4-first-run-creating-your-keychain)
5. [The lock screen](#5-the-lock-screen)
6. [Adding your first API key](#6-adding-your-first-api-key)
7. [Testing a key (the heart of the tool)](#7-testing-a-key-the-heart-of-the-tool)
8. [Reading the dashboard — every element explained](#8-reading-the-dashboard)
9. [Insights — the four colored layers](#9-insights)
10. [Settings — every control explained](#10-settings)
11. [Free vs Pro](#11-free-vs-pro)
12. [Privacy: what leaves your computer](#12-privacy-what-leaves-your-computer)
13. [Keyboard & accessibility](#13-keyboard--accessibility)
14. [How to demo it (a ready-made script)](#14-how-to-demo-it)
15. [Use cases — who needs this](#15-use-cases)
16. [What to be proud of (the shareable facts)](#16-what-to-be-proud-of)
17. [Troubleshooting & FAQ](#17-troubleshooting--faq)
18. [Glossary](#18-glossary)

---

## 1. What AI Keychain is

AI Keychain is a **browser extension that does three connected jobs**:

1. **🔐 Keychain** — stores your AI provider API keys (OpenAI, Anthropic, Google Gemini, OpenRouter) **encrypted on your own machine**. Nothing is uploaded anywhere. There are no accounts and no servers.
2. **🧪 API Tester** — sends a real test request to the provider you chose, directly from your browser, and tells you in plain language whether the key works, how fast it was, what it cost, and — if it failed — *why*, in safe categories instead of scary raw errors.
3. **📊 Command Center** — turns your test activity into private analytics: request counts, success rates, latency, estimated spending, and four layers of "insights" that tell you what actually needs your attention.

The one-line pitch: **"A local-first, encrypted keychain for AI API keys — with a private dashboard that shows usage, cost, and what matters."**

---

## 2. The 60-second mental model

- Your keys live inside an **encrypted vault** in your browser's local storage, sealed with your **master password**. Think of the master password as the only key to a safe that never leaves your house.
- When you **test** a key, the extension opens the safe in memory, sends the key **directly to the provider over HTTPS** (OpenAI to OpenAI, etc.), and immediately records anonymous metadata locally: *did it work, how long did it take, how many tokens, roughly what it cost.*
- That metadata powers the **dashboard**. The keys themselves never appear in the dashboard — only a **masked hint** like `sk-…9f2a`.
- **Lock** the vault and the in-memory key is wiped. Close the browser and it's wiped automatically.

---

## 3. Installing it

Requirements: Node.js 20+ and npm (used only to build; the finished extension doesn't need them), and **Chrome 116 or newer**.

```bash
npm install        # one time
npm run verify     # runs typecheck + full test suite + production build
```

This creates a `dist/` folder — the finished, installable extension.

**Load it into Chrome:**

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `dist/` folder
5. Click the puzzle-piece icon in the toolbar and **pin AI Keychain**

> ⚠️ Note: recent Chrome versions ignore the `--load-extension` command-line flag. Always use **Load unpacked**. (Chrome for Testing / Chromium builds do accept the flag — useful for automated testing.)

**To see the extension update after code changes:** run `npm run build`, then click the ↻ reload icon on the AI Keychain card in `chrome://extensions`.

---

## 4. First run: creating your keychain

Click the AI Keychain toolbar icon. The first time, you'll see a single screen:

- **"Create your keychain"** with two password fields.

Type a **master password** (minimum 8 characters) in both fields and click **Create encrypted vault**.

What you should know:

- This password **encrypts everything**. It is never stored anywhere and never leaves your browser.
- **There is no recovery.** Forget it, and the only option is deleting all data and starting over (Settings has that button). This is deliberate — a recovery path would be a hacker's path too.
- After creation you land **directly in the unlocked dashboard** — no separate login step the first time.

---

## 5. The lock screen

Whenever the vault is sealed, the popup shows **"🔒 Vault locked"** with a single password field.

The vault locks when:

- You click the **lock icon** in the header (top-right of the popup),
- The **auto-lock timer** expires (default: 30 minutes of no activity — you can change or disable it in Settings), or
- You **close and reopen your browser** (the unlock key only ever lives in memory).

Type your master password → click **Unlock**. A wrong password shows *"Wrong master password."* — and nothing else leaves your device in the process.

---

## 6. Adding your first API key

In the dashboard, find the **credential chips row** (the pill-shaped buttons under the header) and click **"+ Add key"**.

The form asks for three things:

| Field | What to enter | Example |
| --- | --- | --- |
| **Provider** | Dropdown: OpenAI, Anthropic, Google Gemini, OpenRouter | OpenAI |
| **Label** | Any name for *you* | `Work — GPT-4o mini` |
| **API key** | Paste the key from the provider's dashboard | starts with `sk-` for OpenAI, `sk-ant-` for Anthropic, `AIza` for Gemini, `sk-or-` for OpenRouter |

Use the small **show** button inside the key field to double-check what you pasted. Then click **Save to vault**. The key is encrypted with your master password *before* it touches storage, and the chip appears with a **masked hint** like `sk-…7890` — enough to recognize it, useless to a thief.

**Free tier limit:** the free version holds **2 credentials**. If you try to add a third, you'll see a friendly upgrade prompt (your existing keys are never touched — see [§11](#11-free-vs-pro)).

**Deleting:** the small **×** on a chip doesn't delete immediately — it turns into **"Sure?"** for 4 seconds. Click again to confirm. This two-step pattern exists on every destructive button so a misclick can never destroy anything.

---

## 7. Testing a key (the heart of the tool)

Select a credential chip, then find the **"Test API — *your label*"** card.

1. **Model** — pick from the dropdown (each provider has a curated list; the default is a cheap, fast model).
2. **Prompt** — optional. Leave blank and it sends *"Reply with the single word OK."* — the cheapest possible test.
3. Click **Send test request**.

While it runs, the button shows a spinner. Within seconds you get one of two results:

**✅ Success** shows:
- A green **Success** pill and the time
- **Model** that answered
- **Tokens** the request consumed
- **Estimated cost** (e.g., `$0.000012 (estimate)`) — computed from a built-in price list. If the model's price isn't known, it honestly says **"Cost unavailable"** instead of guessing.

**❌ Failure** shows:
- A red **Failed** pill and the time
- **Reason** in plain language: *"Authentication failed — the API key was rejected."*
- **Category + HTTP status**, e.g. `auth_invalid · HTTP 401`

The failure view is deliberately minimal: **the provider's raw error response is never shown or stored**, because raw errors can echo secrets. You get the category (`auth_invalid`, `rate_limited`, `timeout`, `network_error`, `server_error`, `not_found`, `malformed_response`…) and nothing that could leak.

Every completed test — success or failure — records **exactly one anonymous usage event**. That's what feeds the dashboard.

---

## 8. Reading the dashboard

Once you have at least one credential and one test, the dashboard comes alive. Top to bottom:

### 8.1 The header
- **Brand + name** (the wordmark hides automatically on very narrow windows)
- **Spinner** appears here briefly whenever data is refreshing
- **Range tabs: 24h · 7d · 30d · All** — the time window for everything below. 30d/All are Pro features; clicking them on the free tier opens the upgrade screen.
- **✦ Pro badge** — shows your tier; click it any time to upgrade or manage your license
- **⤢** — opens the expanded dashboard in a full browser tab (Pro)
- **⚙** — Settings
- **🔒** — Lock the vault now

### 8.2 Credential chips
- **"All credentials"** — the global view: every key's activity combined
- **One chip per key** — click to focus the entire dashboard on that key only (its own stats, charts, failures). The dot color tells you its last test result: green = passed, red = failed, gray = never tested.
- **"+ Add key"** — opens the add form

### 8.3 The six metric cards

| Card | Meaning | Notes |
| --- | --- | --- |
| **Requests** | How many tests ran in the selected window | |
| **Success rate** | % that succeeded | Shows a small colored delta vs the *previous* equal-length window |
| **Est. spend** | Estimated dollars spent | Shows `n/a` honestly when no pricing is known |
| **Tokens** | Total tokens consumed | |
| **Avg latency** | Average response time in ms | With delta vs previous window |
| **Active** | How many providers (`p`) and models (`m`) you've used | |

Deltas (like `+34%`) always compare against the **previous window of the same length** — e.g., 7d vs the 7 days before it.

### 8.4 The charts (each with a plain-text summary)
- **Usage over time** — bars per hour/day; red segments inside a bar are failures
- **Estimated spend** — a filled line chart of spending
- **Latency trend** — average response time over the window
- Every chart has a **text summary underneath** (totals, peaks, "left→right = oldest→newest") and a **date-range caption** — so the data is readable without reading the chart, including for screen readers.

When there's no data in a window, you get an honest sentence ("No requests recorded in this window yet") — never an empty fake chart. If a model's price is unknown, a footer note lists exactly which ones ("Cost unavailable for: …") so nothing is silently missing.

### 8.5 Providers & Models
Two ranked lists showing which providers and which models your traffic went to, with per-item share bars, request counts, percentages, and estimated spend. This is where you spot "90% of my traffic is on one model" instantly.

### 8.6 Recent activity
The last tests, newest first: timestamp, provider · model, and either `OK · 420ms · $0.000012` or `FAILED · auth_invalid`. On a credential's focused view, this shows that key's recent failures.

Analytics history keeps the most recent **5,000 events** (oldest automatically pruned) — effectively years of manual tests.

### 8.7 Insights — what matters now
See the next section. In the actual layout, the Insights card sits between the Usage/Spend charts and the Latency/Providers row — deliberately placed where you can't miss it, while everything in 8.3–8.6 stays fully visible below and around it.

### 8.8 Footer
A constant reminder of the privacy promise: *Local-first · keys encrypted at rest · analytics contain no secrets.*

---

## 9. Insights

Insights are **deterministic, explainable conclusions** the extension draws from your own activity. Every card shows: a colored layer tag, a title, **why it fired** (written in plain English, with the exact threshold), and the **supporting numbers**. (Cards are ranked by an internal score — severity × confidence × magnitude × recency — so the most important card leads; the score itself stays behind the scenes.) If there isn't enough history to justify a conclusion, you get nothing — the extension never invents trends.

| Layer | Color | What it means | Examples |
| --- | --- | --- | --- |
| **★ Need to Know** | Blue | The single most important thing right now | *"Estimated spend 34% above the previous 7 days"* |
| **⚠ Needs Attention** | Red | Actionable problems | *"2 authentication failures in 24 hours"*, *"Timeout spike"*, *"Model unavailable"*, *"High failure rate"*, *'"Work key" has never been tested'* |
| **◔ Watch** | Yellow | Not a problem yet, worth watching | *"Usage up 40%"*, *"Average latency increased 19%"*, *"Token usage up 55%"*, *"92% of traffic on one provider"* |
| **✓ Healthy** | Green | Positive signals worth knowing | *"100% success rate"*, *"Latency improved 22%"*, *'"Work key" passed its last API test'* |

Rules worth knowing:

- **Need to Know** is capped at one card — it's *the* headline. Attention/Watch/Healthy show up to three each, ranked by an explainable score (severity × confidence × magnitude × recency — printed on every card's data).
- **Watch and Healthy cards don't repeat** for 24 hours once shown, so the panel never becomes noise. Problems (red/blue) always show.
- **Free tier** sees ★ Need to Know and ⚠ Needs Attention. **Pro** adds ◔ Watch and ✓ Healthy.
- Every card is **additive** — the raw metrics and charts below never disappear because an insight exists.

---

## 10. Settings

Click **⚙** to open the settings dialog (it traps keyboard focus; press **Escape** to close).

| Control | What it does |
| --- | --- |
| **AI Keychain Pro** | Shows your tier. Free: shows the upgrade link ($19 once) and a **license key** field (activate or restore after reinstall). Pro: shows active status and a **Deactivate** button (frees your activation seat). |
| **Auto-lock after inactivity** | Minutes of inactivity before the vault seals. `0` disables it. Anything invalid (negative, empty, non-numeric) is rejected with a visible message — it can never silently disable your security. Browsing the dashboard counts as activity. |
| **Change master password** | Current + new + confirm. This **decrypts and re-encrypts the entire vault** under a freshly derived key (new random salt). All data survives. |
| **Clear analytics** | Wipes usage history only. Keys stay. Two-click confirm. |
| **Delete all data** | Wipes *everything* — vault, keys, settings, analytics, license — and reloads. Two-click confirm with an explicit *"irreversible"* warning. This is also the "forgot my master password" path. |

---

## 11. Free vs Pro

| | Free | Pro — $19 once |
| --- | --- | --- |
| Credentials | 2 | Unlimited |
| Analytics ranges | 24h, 7d | + 30d, All time |
| Insight layers | ★ Need to Know, ⚠ Needs Attention | + ◔ Watch, ✓ Healthy |
| Expanded dashboard tab | — | ✓ |
| Cost estimates | ✓ basic | ✓ basic |
| Support | Community | Priority |
| Devices | — | ~5 activations (deactivate any time) |
| Data location | Your device | Your device |

Facts that matter:

- **One-time payment** — all version 1.x updates included. No subscription.
- **Your data is identical in both tiers** — paying never changes where data lives, and downgrading never deletes anything.
- **Grandfathering:** if you already had more than 2 keys when the limit appeared (or before a downgrade), they keep working — the limit only applies to *new* keys.
- **Buying:** click the ✦ Pro badge → *Buy Pro* → secure checkout (via our payment partner, Dodo Payments) → you receive a license key by email → paste it into the upgrade screen or Settings. Activation contacts the license service **once** (and re-checks at most weekly, only when you open the popup).
- **Restore after reinstall:** paste the same key again. That's the whole "account system" — deliberately.
- **Deactivate:** frees one of your ~5 activation seats. In the rare case the remote call fails, the seat may stay occupied — it can be freed from the payment dashboard.

---

## 12. Privacy: what leaves your computer

The complete list of network traffic, ever:

1. **Your test requests** — when *you* click Send, the selected key goes **directly to the provider you chose** over HTTPS. The extension never proxies, copies, or inspects this traffic beyond reading success/latency/token counts.
2. **License verification** (Pro users only) — the license key + a random device id, sent to the payment processor's license service on activation and at most weekly. Nothing else.

Everything else — keys, master password, analytics, settings — **never leaves the browser**. There are no accounts, no sync, no telemetry, no logging. Uninstalling the extension deletes every stored byte.

---

## 13. Keyboard & accessibility

- **Tab** moves through everything in a logical order; every control shows a visible focus outline.
- **Enter/Space** activates buttons and chips; **Escape** closes any dialog and returns focus to the button that opened it.
- Dialogs **trap focus** (Tab cycles inside them) so keyboard users can't get lost behind a modal.
- All icon-only buttons have real labels (screen readers announce "Open settings", "Lock vault", etc.).
- Charts announce themselves with summaries ("Requests per bucket, 42 total") plus the text summary below.
- Status is **never color-only** — pills carry words, deltas carry arrows plus a screen-reader note ("versus previous period"), insight cards carry glyphs.
- **Reduced motion** (OS setting) disables all animation.
- Contrast meets WCAG AA — verified arithmetically for every text/background pair, including small print.

---

## 14. How to demo it

A tight 90-second script that shows the value without any setup drama:

**Setup before the demo:** create the vault, add one real (or one intentionally wrong) key, run 3–4 tests so the dashboard has data.

1. **(0:00) The problem.** *"Everyone building with AI juggles API keys in plaintext files and has no idea what they spend. This is a keychain for AI keys that never leaves your machine."*
2. **(0:15) Encryption.** Click **🔒 Lock** → reopen → *"Everything is sealed with AES-256-GCM under this password. 650,000-round key derivation, unique salt, no recovery — like a real safe."* Unlock it.
3. **(0:30) The tester.** Run a test on a key. Point at the result: *"Direct to OpenAI over HTTPS, latency, tokens, and the estimated cost — computed locally from a price list. And when a key is bad, it tells me exactly this: auth failed, HTTP 401 — without ever printing the raw error that could leak the key."*
4. **(0:45) The dashboard.** *"Every test feeds this private dashboard — success rate, latency, spend, per-model breakdown. And this is the part I'm proudest of:"* — point at an insight card — *"it tells me what matters. 'Two authentication failures today.' It explains its threshold, shows its numbers, and if it doesn't have enough data, it says nothing instead of guessing."*
5. **(1:10) Privacy close.** *"No account. No server. No telemetry. The only network traffic is the test call I just made, straight to OpenAI. Uninstall it and it's gone."*
6. **(1:25) The ask.** *"Free for two keys. $19 once for unlimited and the full command center."*

**Tips:** pre-load a failure (wrong key) so the sanitized-error moment lands live; use the 24h range so the numbers are fresh; open Settings briefly to show auto-lock — non-technical people instantly understand why that matters.

---

## 15. Use cases

- **A developer with multiple AI subscriptions** — keep work/personal OpenAI keys, an Anthropic key, and an OpenRouter key in one safe; test each after rotating it; see which model actually costs you money.
- **Post-breach key rotation** — a key leaked in a repo? Revoke it, paste the new one, hit **Send test request** — green pill = rotation confirmed, in two seconds, without touching code.
- **A team lead controlling spend** — the 7d vs previous-7d deltas and the spend chart make "why did our bill jump?" a 10-second answer; the Watch layer flags usage growth before the invoice does.
- **An educator / content creator** — demo AI APIs to students without pasting keys into a shared terminal; the masked hints and sanitized errors are classroom-safe.
- **A security-conscious user** — keys encrypted at rest with a master password, auto-lock, no cloud, no accounts. It's a password manager, but for the AI era.
- **Evaluating models** — run the same prompt through models on different providers and compare latency and estimated cost per request in one place.

---

## 16. What to be proud of (the shareable facts)

All of these are verified in the repository — they're not marketing:

- **Zero-knowledge architecture:** keys encrypted with AES-256-GCM, PBKDF2-SHA-256 at 650,000 rounds, unique random salt per vault, fresh IV per write, password never stored, session key memory-only. No recovery by design.
- **Honest by construction:** unknown model pricing renders *"Cost unavailable"* — it never fabricates a number. Insufficient history renders no insight — it never invents a trend. Unknown values render "—", never zero.
- **Errors can't leak:** provider failures are reduced to fixed categories (`auth_invalid`, `rate_limited`…) with static messages. Raw provider responses — the classic way keys leak — are never displayed or stored. There's a test proving a hostile error message containing your key comes out clean.
- **146 automated tests** across 17 suites — including concurrency races, a corrupted-vault matrix, license-failure matrix, property-based fuzzing of the entire message API (1,500+ generated hostile inputs), and security-invariant tests that grep storage to prove keys never touch disk in plaintext.
- **A 27-point live end-to-end check** that runs the real extension in a real Chromium: create vault → add key → real HTTPS call to OpenAI → sanitized 401 → analytics → insights → wipe. All green.
- **Built by an Inspector system:** every phase was graded by an independent adversarial reviewer against a brutal rubric (this project's scores: core 6.8 → 9.2, UI/UX 5 → 9.4) until it passed the 9.0 production gate.
- **Accessible on purpose:** WCAG AA contrast computed per pair, focus traps, screen-reader summaries for charts, reduced-motion support.
- **Local-first is verifiable, not a slogan:** the manifest's permissions are `storage` + five provider/license hosts — no tabs, no scripting, no content scripts, no telemetry. The compliance doc maps every Chrome Web Store policy to evidence.

---

## 17. Troubleshooting & FAQ

**"My test failed with auth_invalid."** The key is wrong, revoked, or out of quota on the provider's side. Copy a fresh key from the provider dashboard, delete the old chip, re-add, re-test.

**"It says rate_limited / quota_exceeded."** You hit the provider's limits or your account billing. Wait, lower the frequency, or check the provider's billing page. The extension did its job — it told you it's not your key.

**"Estimated cost says: Cost unavailable."** The model you used isn't in the built-in price list. Nothing is guessed; estimates appear automatically for known models.

**"I forgot my master password."** There is no recovery (by design). Settings → **Delete all data**, then start fresh.

**"The popup closed while I was using it!"** Clicking outside a popup closes it — that's Chrome, not a bug. Use the **⤢ expanded tab** for long sessions (Pro).

**"I restarted Chrome and it asks for my password."** Correct — the unlock key only lives in memory and dies with the browser. This is the auto-lock working.

**"I deleted a key — is it recoverable?"** No. Deletion is real (two-step confirmed). That's what makes it trustworthy.

**"Does the free tier hold my existing keys hostage?"** No. If you have more than 2 saved, they all keep working — the limit only stops *new* additions.

**"Where is my data?"** In Chrome's local extension storage, inside your browser profile, encrypted. Deleting the extension or using *Delete all data* removes it entirely.

**"I see 'Couldn't reach the keychain' with a Retry button."** The background service didn't respond (rare — usually right after a browser start). Nothing is lost; click **Retry**, or reload the extension from `chrome://extensions`.

**"The dashboard looks empty."** Add a key and run one test — the dashboard is fed by tests. Empty windows show honest "no data" text rather than fake charts.

---

## 18. Glossary

| Term | Meaning |
| --- | --- |
| **Vault** | The encrypted container holding all your credentials. Sealed/unsealed with your master password. |
| **Master password** | The one password that decrypts the vault. Never stored, never recoverable. |
| **Masked hint** | The safe preview of a key (`sk-…9f2a`) — prefix + last 4 characters. |
| **Usage event** | One anonymous record per test: status, latency, tokens, estimated cost. No keys, no prompts. |
| **Insight** | An automatic, explained conclusion (e.g., "spend up 34% vs last week") with its supporting numbers. |
| **Auto-lock** | Seals the vault after inactivity (default 30 min; 0 = off). |
| **Sanitized error** | A failure reduced to a fixed category + static message — never the provider's raw response. |
| **Entitlement** | Whether you're Free or Pro, stored locally. Downgrading removes features, never data. |
| **Grandfathering** | Pre-limit credentials keep working even above the free cap. |
| **Expanded dashboard** | The full-page analytics view in a browser tab (Pro). |

---

*Last updated: 2026-08-26 · Applies to AI Keychain v1.0 (the v1.1 premium changeset) · This guide is verified against the implementation by the project's Inspector system.*
