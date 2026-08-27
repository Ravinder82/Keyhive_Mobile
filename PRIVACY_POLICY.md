# Privacy Policy — AI Keychain

**Effective date:** 2025-08-25 · **Applies to:** AI Keychain browser extension, version 1.x

AI Keychain is a local-first developer tool. This policy explains exactly what happens to your data. The short version: **your data stays on your device.**

## 1. What AI Keychain stores

Everything AI Keychain knows lives in your browser profile's local extension storage on your own device:

- **Your API credentials** (e.g., provider API keys you choose to save), encrypted with AES-256-GCM under a key derived from your master password (PBKDF2-SHA-256, 650,000 iterations). The plaintext master password and plaintext keys are never written to storage.
- **A session unlock key**, kept only in memory-backed browser storage so you stay unlocked while your browser is open. It is erased when you lock the vault or close your browser, and it never leaves your device.
- **Usage metadata** for the API tests you run: timestamp, provider and model name, success/failure, sanitized error category (e.g., "rate limited"), request latency, token counts, and cost estimates computed from a built-in price list. This is stored locally and capped at 5,000 events.
- **Settings**, such as your auto-lock preference.

## 2. What AI Keychain does NOT do

- It does **not** collect, transmit, sell, rent, or share any of your data with us or any third party. There is no AI Keychain server.
- It does **not** contain telemetry, analytics beacons, logging, advertising, or tracking of any kind.
- It does **not** read or modify web pages you visit. It has no access to website content, browsing history, cookies, or tabs.
- It does **not** store your prompts or the AI's responses.
- It does **not** use your data for advertising, profiling, credit scoring, or training machine-learning models.

## 3. License activation (Pro only)

If you buy AI Keychain Pro, the extension sends your license key and a random per-device instance identifier to our payment processor's license service (Dodo Payments) — once when you activate, and at most when you open the popup after 7 days (lazy re-validation). This verifies your purchase; no other data is included. Dodo Payments' own handling is described in their privacy policy. If you never buy Pro, this call never happens. Removing the license in Settings deletes it from your device.

## 4. The one other exception: your own API test requests

When **you** click "Send test request", AI Keychain sends the selected credential directly — over HTTPS, from your browser — **to the official API endpoint of the provider you chose** (OpenAI, Anthropic, Google, or OpenRouter). That request goes only to the provider you selected and to no one else. That provider's handling of the request is governed by the provider's own privacy policy. AI Keychain never proxies, copies, or inspects this traffic beyond reading the response's usage metadata (token counts) and success/failure status.

## 5. Your control and deletion

You are in full control, in-product, at any time:

- **View/copy** credentials only in masked form (prefix + last 4 characters).
- **Delete** any credential individually.
- **Clear analytics** — wipes all usage metadata.
- **Delete all data** — destroys the vault, credentials, settings, and analytics irreversibly.
- **Uninstall** the extension — removes every stored byte, because all data lives inside the extension's own storage.

There is no password recovery: if you forget your master password, the only option is deleting all data. This is by design.

## 6. Children

AI Keychain is a developer utility not directed at children under 13, and it collects no data from anyone off-device.

## 7. Security

Credentials are encrypted at rest with authenticated encryption and only decrypted in memory to perform actions you initiate. The security architecture, threat model, and cryptographic specification are documented in the project's SECURITY.md.

## 8. Changes to this policy

If a future version changes any data flow, this policy will be updated and the extension's store listing will be re-submitted for review **before** that version ships. The effective date above will change accordingly.

## 9. Contact

Questions about this policy: open an issue on the project's repository or contact the publisher address listed on the Chrome Web Store listing page.

---

*Summary for the Chrome Web Store "Privacy practices" tab: AI Keychain does not collect or transmit user data to the developer or any third party. All user data (credentials, settings, usage metadata) is stored locally on the user's device, is never sold or used for unrelated purposes, and can be deleted completely by the user at any time.*
