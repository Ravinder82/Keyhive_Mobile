# DECISIONS/permissions.md

**Status:** Accepted (V1) · **Scope:** manifest permissions

## Decision
`permissions: ["storage"]` and `host_permissions` for exactly four origins: `api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`, `openrouter.ai`. Nothing else.

## Rationale per permission
- `storage` — vault envelope, settings, analytics. No alternative (IndexedDB still needs no permission but storage.local is simpler and survives cleanly; both are extension-scoped).
- Each host — the tester sends the user's stored key **directly** to that provider's official API over HTTPS from the service worker. Without host permissions, extension-context fetches would be subject to CORS and providers like Anthropic would block them.

## Deliberately excluded
`tabs`, `activeTab`, `scripting`, `cookies`, `webRequest`, `alarms`, `identity`, `unlimitedStorage`, `notifications`, `externally_connectable`, content scripts. Consequences accepted:
- No auto-lock timer push (lazy expiry check instead of `alarms`).
- The expanded dashboard opens via `chrome.tabs.create` on our own `chrome-extension://` page, which needs no `tabs` permission.
- No website autofill (that's V2+ backlog anyway).

## v1.1 note
The Dodo host permission was added with ADR DECISIONS/monetization.md; COMPLIANCE.md, PRIVACY_POLICY.md and the store disclosures were updated in the same change per the rules below.

## Review rule
Any new permission requires a new ADR, a manifest review, and re-approval against the master spec's least-privilege rule.
