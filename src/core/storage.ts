/**
 * Storage abstraction over chrome.storage.local / chrome.storage.session with a
 * memory driver for unit tests. UI code never touches storage directly — only
 * the background service worker imports this module.
 */

export interface KVDriver {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export function memoryDriver(): KVDriver {
  const map = new Map<string, unknown>();
  return {
    async get(key) {
      return map.get(key) as never;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async remove(key) {
      map.delete(key);
    },
  };
}

function chromeArea(area: chrome.storage.StorageArea): KVDriver {
  return {
    async get(key) {
      const res = await area.get(key);
      return res[key] as never;
    },
    async set(key, value) {
      await area.set({ [key]: value });
    },
    async remove(key) {
      await area.remove(key);
    },
  };
}

let localDriver: KVDriver | null = null;
let sessionDriver: KVDriver | null = null;

export function local(): KVDriver {
  if (!localDriver) {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      throw new Error("chrome.storage.local unavailable outside extension context.");
    }
    localDriver = chromeArea(chrome.storage.local);
  }
  return localDriver;
}

export function session(): KVDriver {
  if (!sessionDriver) {
    if (typeof chrome === "undefined" || !chrome.storage?.session) {
      throw new Error("chrome.storage.session unavailable outside extension context.");
    }
    sessionDriver = chromeArea(chrome.storage.session);
  }
  return sessionDriver;
}

/** Storage keys — central registry so retention/deletion stays auditable. */
export const STORAGE_KEYS = {
  vaultEnvelope: "vault.envelope.v1",
  settings: "settings.v1",
  analyticsEvents: "analytics.events.v1",
  premiumEntitlement: "premium.entitlement.v1",
  sessionKey: "session.derivedKey.v1",
  sessionActivity: "session.activity.v1",
} as const;
