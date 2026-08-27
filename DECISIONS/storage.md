# DECISIONS/storage.md

**Status:** Accepted (V1) · **Scope:** persistence & session state

## Decision
- `chrome.storage.local`: vault envelope (ciphertext), settings, analytics events (metadata only). All keys registered in `STORAGE_KEYS` for auditability.
- `chrome.storage.session`: the derived vault key + last-activity timestamp. Memory-backed, cleared when the browser closes, readable only by the extension's own trusted contexts by default.
- Analytics events: single-key append-only ring buffer capped at 5,000 (oldest pruned).

## Why session storage for the key
MV3 suspends idle service workers (~30 s). Holding the key only in a SW global would force a re-unlock every time the worker dies — unusable. `chrome.storage.session` survives worker suspension but not browser restarts, which is exactly the desired "locked when you relaunch, unlocked while you browse" behavior. Lock() erases it immediately; auto-lock (default 30 min, lazy-checked on every privileged call) bounds idle exposure.

## Threat-model note
An attacker with code execution inside the extension's trusted context could read the session key — but that attacker could equally call the message router and do anything the user can. No privilege escalation is created.

## Alternatives considered
- **Re-derive per operation (no session key)** — a 650k-iteration KDF per message would make the UI sluggish and require the master password in memory anyway.
- **IndexedDB for analytics** — over-engineered for ≤5,000 small events; storage.local keeps the audit surface minimal.
- **Per-event storage keys** — unbounded key count; rejected.
