# DECISIONS/crypto.md

**Status:** Accepted (V1) · **Scope:** vault cryptography

## Decision
Native WebCrypto only: PBKDF2-HMAC-SHA-256 with 650,000 iterations and a per-vault random 16-byte salt, deriving an AES-256-GCM key. Fresh random 12-byte IV for every encryption. Versioned envelope (`v:1`).

## Alternatives considered
- **Argon2id (WASM)** — stronger memory-hardness, but adds a third-party WASM dependency to the most security-critical path, complicating auditability and supply chain. OWASP currently rates PBKDF2-SHA-256 ≥600k iterations as acceptable for password storage. Revisit if threat model escalates.
- **Lower iterations for snappy unlock** — unlock takes ~300–600 ms; acceptable UX for a security product. Do not lower.
- **Encrypting per-credential instead of whole payload** — more granular, but V1 credential counts are tiny; whole-payload sealing keeps the code auditable and password-change trivial (single reseal).

## Consequences
- Wrong password and corrupted ciphertext both fail GCM auth; we surface `WrongPasswordError` (credential problem first) and `CorruptVaultError` for shape errors.
- Password change = decrypt with old key, re-encrypt under newly derived key (new salt) — matches the master spec verbatim.
- Envelope is versioned for future migrations; `assertEnvelopeShape` rejects unknown versions loudly.
