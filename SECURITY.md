# SECURITY.md

## 1. Threat model

### Assets
1. **API keys** (provider credentials) — highest value.
2. **Master password** — protects the vault.
3. **Usage analytics** — sensitive metadata (request counts, latency, tokens, cost estimates) though never secret-bearing.

### Adversaries considered
| Adversary | Capability | Mitigation |
| --- | --- | --- |
| Local malware (unprivileged) | Reads disk files | Vault at rest is AES-256-GCM ciphertext under a 650k-iteration PBKDF2 key; plaintext keys never written to disk (verified by test). |
| Person with brief access to unlocked browser | Opens the popup | Auto-lock (default 30 min) + manual lock wipes the in-memory key. Popup requires OS-level user session anyway. |
| Malicious website | XSS, fetch to providers | Extension pages are isolated; no `externally_connectable`; no content scripts; no `tabs`/`scripting` permissions; keys never appear in URLs. |
| Network attacker | Traffic interception | All provider calls are HTTPS to pinned official domains via `host_permissions`. No proxy, no third-party endpoints. |
| Compromised provider | Returns malicious responses | Responses are parsed for usage metadata only; error bodies are discarded and mapped to static categories — never rendered, stored or logged. |
| Curious extension observer (other extensions) | Extension messaging | No `externally_connectable` ⇒ other extensions cannot message AI Keychain. `chrome.storage.session` defaults to trusted-contexts-only access. |
| Physical disk theft | Full disk image | Same as (1). No cloud copy exists to breach. |

### Out of scope (accepted residuals)
- **Malware running inside the browser/extension context** (e.g., a malicious other extension with debug access, or a compromised Chrome) can do anything the user can; no extension can defend against code execution in its own context.
- **Weak master passwords.** Strength is enforced ≥8 chars; entropy is the user's responsibility. No recovery exists by design.
- **Memory forensics on a live machine** while the vault is unlocked (the derived key must exist in memory to be useful). Minimized via session-only storage and immediate lock.
- **Final-event loss on browser close:** the usage event of a test request that completes in the moments before the browser is closed may be lost (the completion journal lives in memory-backed session storage). This affects at most the most recent event's analytics — never credentials or security.
- **Delete-all vs. in-flight requests:** a wipe fences in-flight test completions via a generation counter. The counter is module-level, so a service-worker restart resets it — harmless, because a worker kill also kills any in-flight writer; no stale writer can survive a restart to observe the reset.
- **Unlock/password-change commits** verify the on-disk envelope (by ciphertext) before installing a session key, so concurrent admin operations can never install a stale key; the losing operation surfaces "locked" and the user simply retries.

## 2. Cryptographic specification

| Parameter | Value |
| --- | --- |
| KDF | PBKDF2-HMAC-SHA-256 (native WebCrypto) |
| Iterations | 650,000 |
| Salt | 16 random bytes, unique per vault, rotated on password change |
| AEAD | AES-256-GCM |
| IV | 12 random bytes per encryption operation (fresh on every write) |
| Envelope | versioned (`v:1`): kdf params + aead label + iv + ciphertext + timestamps |

Properties:
- **Authenticated encryption**: wrong password/corruption fails GCM auth (`WrongPasswordError`).
- **Password change** decrypts the payload with the old key and re-encrypts under a newly derived key (new salt) — `resealEnvelope`.
- **No key material at rest**: the derived key is stored only in `chrome.storage.session` (RAM-backed, cleared on browser exit, trusted-contexts-only read access) so the session survives MV3 service-worker suspension. `lockVault()` erases it immediately; lazy auto-lock enforces the idle deadline on every privileged call.
- The master password itself is never persisted anywhere, ever.

## 3. Secret handling rules (enforced by tests)

1. API keys exist in plaintext **only** in the SW's memory during a request, and inside the encrypted envelope at rest.
2. Keys are sent **only** to the official provider endpoint over HTTPS, in headers (never URLs — Gemini uses `x-goog-api-key`).
3. Analytics events contain: ids, timestamps, provider/model, status, sanitized category, latency, token counts, cost estimate. Nothing else. `tests/security.test.ts` asserts storage never contains key material and events never contain prompts/keys.
4. Errors are mapped to **static** category strings (`auth_invalid`, `rate_limited`, …) — provider response bodies are never surfaced, stored or logged (`tests/providers.test.ts` asserts leak-free outcomes even when the provider echoes the key back).
5. Masked hints show only the key prefix and final 4 chars.
6. No logging anywhere in the codebase (no `console.log` in shipped code paths).
7. No telemetry. No remote code. No eval. No content scripts.

## 4. Permissions rationale (least privilege)

| Permission | Why needed | Why not more |
| --- | --- | --- |
| `storage` | Vault envelope, settings, analytics | — |
| `https://api.openai.com/*` | Direct OpenAI calls | — |
| `https://api.anthropic.com/*` | Direct Anthropic calls | — |
| `https://generativelanguage.googleapis.com/*` | Direct Gemini calls | — |
| `https://openrouter.ai/*` | Direct OpenRouter calls | — |

Deliberately absent: `tabs`, `scripting`, `cookies`, `webRequest`, `alarms`, `identity`, `unlimitedStorage`, `externally_connectable`, content scripts, background page (MV3 worker only). The expanded dashboard tab is opened with `chrome.tabs.create` on the extension's own page, which requires no extra permission.

## 5. Data lifecycle

- **Retention**: analytics capped at 5,000 events (oldest pruned). Vault envelope + settings persist until deleted.
- **Deletion controls** (Settings): *Clear analytics* (events only), *Delete all data* (vault + settings + events + session, then reload). Deleting the extension removes everything since all state is extension-scoped storage.
- **Export**: none in V1 (avoids creating plaintext egress paths).

## 6. Supply chain

- Runtime dependencies: `react`, `react-dom` only. No crypto libraries (native WebCrypto), no HTTP libraries (native fetch), no analytics SDKs.
- Icons are generated by a zero-dependency Node script (`scripts/generate-icons.mjs`) using only `node:zlib` — original artwork, no third-party assets.
- Dev dependencies (TypeScript, Vite, Vitest, React types, testing-library, jsdom, @types) never ship in `dist/`.

## 7. Verification evidence

- `tests/crypto.test.ts` — round-trip, wrong-password, salt/IV uniqueness, reseal, corruption detection
- `tests/vault.test.ts` — lifecycle, lock invalidation, auto-lock expiry, encryption-at-rest, password change
- `tests/security.test.ts` — no plaintext key in storage/session leakage, masked hints, event hygiene, error sanitization, envelope shape
- `tests/providers.test.ts` — sanitized failures for 401/429/5xx/network/timeout/malformed, key-never-in-URL
- Live browser run (Chromium 151, CDP-driven): 27/27 checks including real 401 from api.openai.com producing a sanitized outcome and no key material in storage — see TESTING.md.
