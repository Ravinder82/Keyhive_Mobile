/**
 * Vault lifecycle: create / unlock / lock / change password / credential
 * persistence. Runs only inside the background service worker.
 *
 * Session policy (see DECISIONS/storage.md):
 *  - The derived vault key is kept ONLY in chrome.storage.session, which is
 *    memory-backed and cleared when the browser closes. It is never written to
 *    disk and never leaves the extension.
 *  - Lock() erases it immediately. Auto-lock is enforced lazily on every
 *    privileged operation against a stored activity deadline.
 */

import type { CredentialRecord, VaultEnvelope, VaultPayload } from "../shared/types";
import {
  CorruptVaultError,
  decryptWithKey,
  encryptWithKey,
  exportKeyRaw,
  fromB64,
  importKeyRaw,
  openEnvelope,
  openEnvelopeWithKey,
  resealEnvelopeWithKey,
  sealEnvelopeWithKey,
} from "./crypto";
import { DomainError } from "./errors";
import { uuid } from "./ids";
import { STORAGE_KEYS, local, session } from "./storage";

export class LockedError extends Error {
  constructor() {
    super("Vault is locked.");
    this.name = "LockedError";
  }
}

const CHECK_VALUE = "ai-keychain-vault-check-v1";

async function loadEnvelope(): Promise<VaultEnvelope | undefined> {
  return local().get<VaultEnvelope>(STORAGE_KEYS.vaultEnvelope);
}

// ------------------------------------------------------------- session state

async function storeSessionKey(key: CryptoKey): Promise<void> {
  const raw = await exportKeyRaw(key);
  await session().set(STORAGE_KEYS.sessionKey, Array.from(raw).join(","));
}

async function loadSessionKey(): Promise<CryptoKey | null> {
  const joined = await session().get<string>(STORAGE_KEYS.sessionKey);
  if (!joined) return null;
  const raw = new Uint8Array(joined.split(",").map((s) => parseInt(s, 10)));
  if (raw.some((n) => Number.isNaN(n))) return null;
  return importKeyRaw(raw);
}

async function clearSessionKey(): Promise<void> {
  await session().remove(STORAGE_KEYS.sessionKey);
}

/** Auto-lock deadline in epoch ms; null disables auto-lock. */
async function autoLockDeadline(): Promise<number | null> {
  const minutes = (await getSettings()).autoLockMinutes;
  if (!minutes) return null;
  const last = (await session().get<number>(STORAGE_KEYS.sessionActivity)) ?? Date.now();
  return last + minutes * 60_000;
}

/**
 * Records user activity, extending the auto-lock deadline. Called by the
 * background on dashboard reads so actively-viewing users are not locked out.
 */
export async function touchActivity(): Promise<void> {
  await session().set(STORAGE_KEYS.sessionActivity, Date.now());
}

// ------------------------------------------------------------------ settings

export async function getSettings(): Promise<{ autoLockMinutes: number }> {
  const s = await local().get<{ autoLockMinutes?: number }>(STORAGE_KEYS.settings);
  return { autoLockMinutes: s?.autoLockMinutes ?? 30 };
}

export async function setSettings(patch: Partial<{ autoLockMinutes: number }>): Promise<void> {
  const next = { ...(await getSettings()), ...patch };
  await local().set(STORAGE_KEYS.settings, next);
}

// ------------------------------------------------------------------ public API

export async function vaultExists(): Promise<boolean> {
  return Boolean(await loadEnvelope());
}

export async function isUnlocked(): Promise<boolean> {
  const key = await loadSessionKey();
  if (!key) return false;
  const deadline = await autoLockDeadline();
  if (deadline !== null && Date.now() >= deadline) {
    await lockVault();
    return false;
  }
  return true;
}

export async function lockVault(): Promise<void> {
  await clearSessionKey();
  await session().remove(STORAGE_KEYS.sessionActivity);
}

export async function autoLockAt(): Promise<number | null> {
  if (!(await isUnlocked())) return null;
  return autoLockDeadline();
}

export async function createVault(password: string): Promise<void> {
  assertPasswordStrength(password);
  if (await vaultExists()) {
    throw new DomainError("vault_exists", "A vault already exists on this browser profile.");
  }
  const payload: VaultPayload & { check: string } = { check: CHECK_VALUE, credentials: [] };
  // Single derivation: seal and keep the key for the session in one pass.
  const { envelope, key } = await sealEnvelopeWithKey(password, JSON.stringify(payload));
  await local().set(STORAGE_KEYS.vaultEnvelope, envelope);
  await storeSessionKey(key);
  await touchActivity();
}

/**
 * Heavy part of unlock (KDF + authentication) — runs OUTSIDE the mutex so a
 * slow or wrong-password unlock never delays other operations.
 */
export async function prepareUnlock(
  password: string,
): Promise<{ key: CryptoKey; envelope: VaultEnvelope }> {
  const envelope = await loadEnvelope();
  if (!envelope) throw new DomainError("no_vault", "No vault exists yet.");
  const { plaintext, key } = await openEnvelopeWithKey(password, envelope);
  parsePayload(plaintext);
  return { key, envelope };
}

/**
 * Fast part of unlock — must run inside the exclusive mutex. Verifies the
 * envelope on disk is still the one that was prepared: a concurrent password
 * change or data wipe during the KDF aborts the commit instead of installing
 * a stale or orphaned session key.
 */
export async function commitUnlock(prepared: {
  key: CryptoKey;
  envelope: VaultEnvelope;
}): Promise<void> {
  const current = await loadEnvelope();
  if (!current) throw new DomainError("no_vault", "No vault exists.");
  // Compare ciphertext, not timestamps: every write re-seals with a fresh IV,
  // so identical ctB64 proves the on-disk envelope is exactly the prepared one
  // even when writes land within the same millisecond.
  if (current.ctB64 !== prepared.envelope.ctB64) {
    throw new LockedError();
  }
  await storeSessionKey(prepared.key);
  await touchActivity();
}

export async function unlockVault(password: string): Promise<void> {
  await commitUnlock(await prepareUnlock(password));
}

/**
 * Heavy part of password change (two KDFs + re-encryption) — runs OUTSIDE the
 * mutex. Verifies the current password and produces the new envelope + key.
 */
export async function preparePasswordChange(
  current: string,
  next: string,
): Promise<{ envelope: VaultEnvelope; key: CryptoKey; baseCtB64: string }> {
  assertPasswordStrength(next);
  const envelope = await loadEnvelope();
  if (!envelope) throw new DomainError("no_vault", "No vault exists yet.");
  const baseCtB64 = envelope.ctB64;
  const sealed = await resealEnvelopeWithKey(current, next, envelope);
  return { ...sealed, baseCtB64 };
}

/**
 * Fast part of password change — must run inside the exclusive mutex. Aborts
 * if the on-disk envelope changed while the re-encryption was running, so a
 * concurrent write can never be silently overwritten by a stale seal.
 */
export async function commitPasswordChange(prepared: {
  envelope: VaultEnvelope;
  key: CryptoKey;
  baseCtB64: string;
}): Promise<void> {
  const current = await loadEnvelope();
  if (!current || current.ctB64 !== prepared.baseCtB64) {
    throw new LockedError();
  }
  await local().set(STORAGE_KEYS.vaultEnvelope, prepared.envelope);
  await clearSessionKey();
  await storeSessionKey(prepared.key);
  await touchActivity();
}

export async function changeMasterPassword(current: string, next: string): Promise<void> {
  await commitPasswordChange(await preparePasswordChange(current, next));
}

function parsePayload(plaintext: string): VaultPayload & { check?: string } {
  let parsed: VaultPayload & { check?: string };
  try {
    parsed = JSON.parse(plaintext) as VaultPayload & { check?: string };
  } catch {
    throw new CorruptVaultError("payload-json");
  }
  if (!parsed || !Array.isArray(parsed.credentials)) throw new CorruptVaultError("payload");
  return parsed;
}

/** Decrypts the credential list with the in-memory session key. Enforces auto-lock. */
export async function readCredentials(): Promise<CredentialRecord[]> {
  return (await readPayload()).credentials;
}

/** Re-seals the full credential list under the session key with a fresh IV. */
export async function writeCredentials(credentials: CredentialRecord[]): Promise<void> {
  if (!(await isUnlocked())) throw new LockedError();
  const key = await loadSessionKey();
  const envelope = await loadEnvelope();
  if (!key || !envelope) throw new LockedError();
  const payload: VaultPayload & { check: string } = { check: CHECK_VALUE, credentials };
  const { ivB64, ctB64 } = await encryptWithKey(key, JSON.stringify(payload));
  const next: VaultEnvelope = { ...envelope, ivB64, ctB64, updatedAt: Date.now() };
  await local().set(STORAGE_KEYS.vaultEnvelope, next);
  await touchActivity();
}

async function readPayload(): Promise<VaultPayload & { check?: string }> {
  if (!(await isUnlocked())) throw new LockedError();
  const key = await loadSessionKey();
  const envelope = await loadEnvelope();
  if (!key || !envelope) throw new LockedError();
  const plaintext = await decryptWithKey(key, envelope.ivB64, envelope.ctB64);
  return parsePayload(plaintext);
}

export function assertPasswordStrength(password: string): void {
  if (typeof password !== "string" || password.length < 8) {
    throw new DomainError("weak_password", "Master password must be at least 8 characters.");
  }
  if (password.length > 256) {
    throw new DomainError("weak_password", "Master password is too long.");
  }
}

export function newCredentialId(): string {
  return uuid();
}
