/**
 * Vault cryptography.
 *
 * Design (see DECISIONS/crypto.md and SECURITY.md):
 *  - Key derivation: PBKDF2-HMAC-SHA-256, 650,000 iterations, unique random
 *    16-byte salt per vault. Native WebCrypto — no third-party crypto code.
 *  - Encryption: AES-256-GCM (authenticated) with a fresh random 12-byte IV
 *    for every encryption operation.
 *  - The master password is never persisted; only the derived key may live in
 *    chrome.storage.session (memory-backed, cleared when the browser closes).
 *  - Unlock verification uses a known-plaintext check value inside the sealed
 *    payload; a wrong password fails GCM authentication.
 *  - Envelope is versioned for future migrations.
 */

import type { VaultEnvelope } from "../shared/types";

const KDF_ALG = "PBKDF2";
const KDF_HASH = "SHA-256";
/** Envelope label for the KDF (WebCrypto calls it just "PBKDF2"). */
const ENVELOPE_KDF_ALG = "PBKDF2-SHA256";
export const KDF_ITERATIONS = 650_000;
const AEAD = "AES-GCM";
const IV_BYTES = 12;
const SALT_BYTES = 16;

export class WrongPasswordError extends Error {
  constructor() {
    super("Wrong master password.");
    this.name = "WrongPasswordError";
  }
}

export class CorruptVaultError extends Error {
  constructor(detail: string) {
    super(`Vault integrity check failed (${detail}).`);
    this.name = "CorruptVaultError";
  }
}

function subtle(): SubtleCrypto {
  if (typeof globalThis.crypto?.subtle === "undefined") {
    throw new Error("WebCrypto unavailable in this environment.");
  }
  return globalThis.crypto.subtle;
}

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await subtle().importKey(
    "raw",
    new TextEncoder().encode(password),
    KDF_ALG,
    false,
    ["deriveKey"],
  );
  return subtle().deriveKey(
    { name: KDF_ALG, salt: salt as BufferSource, iterations, hash: KDF_HASH },
    material,
    { name: AEAD, length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

export async function encryptWithKey(
  key: CryptoKey,
  plaintext: string,
): Promise<{ ivB64: string; ctB64: string }> {
  const iv = randomBytes(IV_BYTES);
  const ct = await subtle().encrypt(
    { name: AEAD, iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { ivB64: toB64(iv), ctB64: toB64(new Uint8Array(ct)) };
}

export async function decryptWithKey(
  key: CryptoKey,
  ivB64: string,
  ctB64: string,
): Promise<string> {
  try {
    const pt = await subtle().decrypt(
      { name: AEAD, iv: fromB64(ivB64) as BufferSource },
      key,
      fromB64(ctB64) as BufferSource,
    );
    return new TextDecoder().decode(pt);
  } catch {
    throw new WrongPasswordError();
  }
}

/** Seals plaintext into a versioned envelope using a freshly derived key. */
export async function sealEnvelope(
  password: string,
  plaintext: string,
): Promise<VaultEnvelope> {
  return (await sealEnvelopeWithKey(password, plaintext)).envelope;
}

/** As sealEnvelope, but also returns the derived key (avoids a second KDF). */
export async function sealEnvelopeWithKey(
  password: string,
  plaintext: string,
): Promise<{ envelope: VaultEnvelope; key: CryptoKey }> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt, KDF_ITERATIONS);
  const { ivB64, ctB64 } = await encryptWithKey(key, plaintext);
  return {
    envelope: {
      v: 1,
      kdf: { alg: ENVELOPE_KDF_ALG, iterations: KDF_ITERATIONS, saltB64: toB64(salt) },
      aead: "AES-256-GCM",
      ivB64,
      ctB64,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    key,
  };
}

/** Opens an envelope. Throws WrongPasswordError or CorruptVaultError. */
export async function openEnvelope(
  password: string,
  envelope: VaultEnvelope,
): Promise<string> {
  return (await openEnvelopeWithKey(password, envelope)).plaintext;
}

/** As openEnvelope, but also returns the derived key (avoids a second KDF). */
export async function openEnvelopeWithKey(
  password: string,
  envelope: VaultEnvelope,
): Promise<{ plaintext: string; key: CryptoKey }> {
  assertEnvelopeShape(envelope);
  const salt = fromB64(envelope.kdf.saltB64);
  const key = await deriveKey(password, salt, envelope.kdf.iterations);
  try {
    const pt = await decryptWithKey(key, envelope.ivB64, envelope.ctB64);
    return { plaintext: pt, key };
  } catch (err) {
    // GCM authentication failure covers both wrong password and corrupted
    // ciphertext; surface it as a credential problem first.
    throw err instanceof WrongPasswordError ? err : new CorruptVaultError("auth");
  }
}

/**
 * Re-seals payload under a newly derived key (new salt). Semantically this is
 * "decrypt with old key, re-encrypt with new key" per the security spec.
 */
export async function resealEnvelope(
  currentPassword: string,
  nextPassword: string,
  envelope: VaultEnvelope,
): Promise<VaultEnvelope> {
  return (await resealEnvelopeWithKey(currentPassword, nextPassword, envelope)).envelope;
}

/** As resealEnvelope, but also returns the NEW key for the session. */
export async function resealEnvelopeWithKey(
  currentPassword: string,
  nextPassword: string,
  envelope: VaultEnvelope,
): Promise<{ envelope: VaultEnvelope; key: CryptoKey }> {
  const plaintext = await openEnvelope(currentPassword, envelope);
  const next = await sealEnvelopeWithKey(nextPassword, plaintext);
  return {
    envelope: { ...next.envelope, createdAt: envelope.createdAt },
    key: next.key,
  };
}

export async function exportKeyRaw(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await subtle().exportKey("raw", key));
}

export async function importKeyRaw(raw: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey("raw", raw as BufferSource, { name: AEAD }, true, [
    "encrypt",
    "decrypt",
  ]);
}

function assertEnvelopeShape(e: VaultEnvelope): void {
  if (
    e?.v !== 1 ||
    e.kdf?.alg !== ENVELOPE_KDF_ALG ||
    typeof e.kdf?.iterations !== "number" ||
    !Number.isInteger(e.kdf.iterations) ||
    // Clamp persisted KDF parameters: a tampered/corrupt envelope must not be
    // able to make unlock do absurd work (DoS) or trivial work.
    e.kdf.iterations < 100_000 ||
    e.kdf.iterations > 2_000_000 ||
    e.aead !== "AES-256-GCM" ||
    typeof e.ivB64 !== "string" ||
    typeof e.ctB64 !== "string"
  ) {
    throw new CorruptVaultError("envelope-shape");
  }
}
