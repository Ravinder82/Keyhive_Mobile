/**
 * Entitlement store + premium service (runs in the background worker only).
 * Storage: chrome.storage.local under its own key — readable WITHOUT unlock
 * so the Pro badge renders before the vault is opened.
 */

import { DomainError } from "../core/errors";
import { STORAGE_KEYS, local } from "../core/storage";
import { uuid } from "../core/ids";
import type { EntitlementRecord } from "./entitlements";
import { FREE_ENTITLEMENT, isPro } from "./entitlements";
import { dodoLicenseClient, LicenseError } from "./license";
import { REVALIDATE_AFTER_MS } from "./config";

export async function getEntitlement(): Promise<EntitlementRecord> {
  const rec = await local().get<EntitlementRecord>(STORAGE_KEYS.premiumEntitlement);
  return rec ?? FREE_ENTITLEMENT;
}

async function setEntitlement(ent: EntitlementRecord): Promise<void> {
  await local().set(STORAGE_KEYS.premiumEntitlement, ent);
}

const INSTANCE_KEY = "premium.instanceName.v1";

/** Stable per-install device label: re-activations reuse the same seat instead of burning new ones. */
async function instanceName(): Promise<string> {
  const existing = await local().get<string>(INSTANCE_KEY);
  if (existing) return existing;
  const name = `device-${uuid().slice(0, 8)}`;
  await local().set(INSTANCE_KEY, name);
  return name;
}

/** Paste-key activation. Throws LicenseError with a typed reason on failure. */
export async function activateLicense(licenseKey: string): Promise<EntitlementRecord> {
  const key = licenseKey.trim();
  if (!key || key.length > 200) {
    throw new DomainError("invalid_input", "Enter a valid license key.");
  }
  try {
    const ent = await dodoLicenseClient.activate(key, await instanceName());
    await setEntitlement(ent);
    return ent;
  } catch (err) {
    if (err instanceof LicenseError && err.reason !== "network") {
      throw new DomainError("invalid_input", err.message);
    }
    throw err; // network: keep current state, surface a retryable message
  }
}

/** Removes the local license (restore = re-paste the key). Frees the seat remotely when possible. */
export async function deactivateLicense(): Promise<EntitlementRecord> {
  const ent = await getEntitlement();
  if (ent.licenseKey && ent.instanceId) {
    try {
      await dodoLicenseClient.deactivate(ent.licenseKey, ent.instanceId);
    } catch {
      // Seat stays occupied remotely; the user can free it from the vendor
      // dashboard. Local downgrade always succeeds.
    }
  }
  await setEntitlement(FREE_ENTITLEMENT);
  return FREE_ENTITLEMENT;
}

/**
 * Lazy revalidation (Inspector change: user-initiated, no alarms). Called on
 * popup open. A network flake NEVER downgrades; an explicit invalid/expired/
 * disabled verdict does.
 */
export async function revalidateIfNeeded(): Promise<EntitlementRecord> {
  const ent = await getEntitlement();
  if (!isPro(ent) || !ent.licenseKey || !ent.instanceId) return ent;
  if (ent.lastValidatedAt && Date.now() - ent.lastValidatedAt < REVALIDATE_AFTER_MS) return ent;
  try {
    const fresh = await dodoLicenseClient.validate(ent.licenseKey, ent.instanceId);
    await setEntitlement(fresh);
    return fresh;
  } catch (err) {
    if (err instanceof LicenseError && err.reason !== "network") {
      await setEntitlement(FREE_ENTITLEMENT);
      return FREE_ENTITLEMENT;
    }
    return ent; // offline flake: keep current state
  }
}
