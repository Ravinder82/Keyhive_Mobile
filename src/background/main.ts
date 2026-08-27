/**
 * MV3 service worker: the only privileged context. Owns vault operations,
 * credential CRUD, provider requests, analytics persistence and insight
 * generation. The popup/dashboard UI communicates exclusively through typed
 * messages below and never touches storage or provider APIs directly.
 *
 * Concurrency model:
 *  - All read-modify-write sequences run inside withExclusiveLock.
 *  - test/run performs its network call WITHOUT holding the lock, then
 *    re-reads credentials inside the lock before writing — a credential or
 *    analytics change made mid-request can never be lost.
 *  - The completed usage event is journaled to session storage before it is
 *    appended and replayed on worker start, so a worker reclaimed mid-write
 *    still yields exactly one event per completed request.
 */

import {
  breakdown,
  buildSeries,
  inWindow,
  modelsWithoutPricing,
  recentActivity,
  summarize,
} from "../analytics/aggregate";
import { appendEvents, appendEventsUnsafe, clearAnalytics, loadEvents } from "../analytics/store";
import { eventFromOutcome } from "../analytics/events";
import { estimateCost } from "../cost/engine";
import { DomainError } from "../core/errors";
import { withExclusiveLock } from "../core/mutex";
import { session } from "../core/storage";
import { CorruptVaultError, WrongPasswordError } from "../core/crypto";
import {
  changeMasterPassword,
  commitPasswordChange,
  commitUnlock,
  createVault,
  getSettings,
  isUnlocked,
  lockVault,
  LockedError,
  newCredentialId,
  preparePasswordChange,
  prepareUnlock,
  readCredentials,
  setSettings,
  touchActivity,
  unlockVault,
  vaultExists,
  writeCredentials,
} from "../core/vault";
import { applyRepeatSuppression, generateInsights } from "../insights/engine";
import {
  FREE_MAX_CREDENTIALS,
  isPro,
  isRangeAllowed,
  layerAllowed,
} from "../premium/entitlements";
import type { EntitlementRecord } from "../premium/entitlements";
import {
  activateLicense,
  deactivateLicense,
  getEntitlement,
  revalidateIfNeeded,
} from "../premium/store";
import { getAdapter, listProviderCatalog } from "../providers/registry";
import type {
  BgRequest,
  CredentialMeta,
  DashboardSnapshot,
  ExtensionSettings,
  GlobalDashboardData,
  RangeKey,
  TestOutcome,
  UsageEvent,
} from "../shared/types";
import { isProviderId, isRangeKey, maskApiKey } from "../shared/types";

// ------------------------------------------------------- pending-test journal

const PENDING_EVENT_KEY = "session.pendingUsageEvent.v1";
const SEEN_INSIGHTS_KEY = "session.insightSeen.v1";

async function journalEvent(e: UsageEvent): Promise<void> {
  await session().set(PENDING_EVENT_KEY, e);
}

async function clearEventJournal(): Promise<void> {
  await session().remove(PENDING_EVENT_KEY);
}

/** Replays a journaled event after a worker restart. Idempotent (appendEvents dedupes by eventId). */
export async function reconcilePendingEvents(): Promise<void> {
  const pending = await session().get<UsageEvent>(PENDING_EVENT_KEY);
  if (pending) {
    await appendEvents([pending]);
    await clearEventJournal();
  }
}

// Reconcile on every worker cold start (top-level, fire-and-forget).
void reconcilePendingEvents().catch(() => undefined);

// ------------------------------------------------------------------ routing

/**
 * Bumped under the mutex whenever all data is wiped. In-flight test requests
 * compare it after their network leg and refuse to record events for data
 * that no longer exists.
 */
let dataGeneration = 0;

chrome.runtime.onMessage.addListener((req: BgRequest, _sender, sendResponse) => {
  const handler = handlers[req?.type];
  if (!handler) {
    sendResponse({ ok: false, code: "internal", message: "Unknown request type." });
    return false;
  }
  try {
    // Promise.resolve: a handler that throws SYNCHRONOUSLY (validation before
    // its first await) must still become a typed error response, not a dead
    // message port.
    Promise.resolve(handler(req as never))
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err: unknown) => {
        sendResponse({ ok: false, ...errorFor(err) });
      });
  } catch (err) {
    sendResponse({ ok: false, ...errorFor(err) });
  }
  return true; // async sendResponse
});

function errorFor(err: unknown): { code: string; message: string } {
  if (err instanceof DomainError) return { code: err.code, message: err.message };
  if (err instanceof WrongPasswordError) return { code: "wrong_password", message: err.message };
  if (err instanceof LockedError) return { code: "locked", message: err.message };
  if (err instanceof CorruptVaultError) {
    return { code: "corrupt_vault", message: "Vault data appears corrupted on this device." };
  }
  const e = err as { message?: string };
  const msg = e?.message;
  return {
    code: "internal",
    message: msg && msg.length < 200 && !msg.includes("{") ? msg : "Something went wrong.",
  };
}

// ------------------------------------------------------------ input guards

function requireString(v: unknown, field: string, max = 512): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new DomainError("invalid_input", `${field} is required.`);
  }
  if (v.length > max) {
    throw new DomainError("invalid_input", `${field} is too long.`);
  }
  return v;
}

function requireObject(v: unknown, field: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw new DomainError("invalid_input", `${field} is required.`);
  }
  return v as Record<string, unknown>;
}

// ------------------------------------------------------------------ handlers

const handlers: Record<string, (req: never) => Promise<unknown>> = {
  "vault/status": async () => ({
    exists: await vaultExists(),
    unlocked: await isUnlocked(),
  }),

  "vault/create": (req: Extract<BgRequest, { type: "vault/create" }>) => {
    requireObject(req, "request");
    requireString((req as { password?: unknown }).password, "Password", 256);
    return withExclusiveLock(() => createVault((req as { password: string }).password));
  },

  "vault/unlock": async (req: Extract<BgRequest, { type: "vault/unlock" }>) => {
    requireObject(req, "request");
    const password = requireString((req as { password?: unknown }).password, "Password", 256);
    // Heavy KDF + authentication OUTSIDE the mutex; only the fast session
    // commit is serialized, so a wrong-password unlock never stalls writes.
    const prepared = await prepareUnlock(password);
    await withExclusiveLock(() => commitUnlock(prepared));
    return { ok: true };
  },

  "vault/lock": async () => {
    await lockVault();
    return { ok: true };
  },

  "vault/changePassword": async (
    req: Extract<BgRequest, { type: "vault/changePassword" }>,
  ) => {
    const body = requireObject(req, "request");
    const current = requireString(body.current, "Current password", 256);
    const next = requireString(body.next, "New password", 256);
    // Re-encryption happens outside the mutex; the swap is atomic under it.
    const prepared = await preparePasswordChange(current, next);
    await withExclusiveLock(() => commitPasswordChange(prepared));
    return { ok: true };
  },

  "cred/list": async () => (await readCredentials()).map(toMeta),

  "cred/add": (req: Extract<BgRequest, { type: "cred/add" }>) => {
    const body = requireObject(req, "request");
    const label = requireString(body.label, "Label", 100);
    const apiKey = requireString(body.apiKey, "API key", 512);
    const provider = body.provider;
    if (!isProviderId(provider)) {
      throw new DomainError("invalid_input", "Unknown provider.");
    }
    return withExclusiveLock(async () => {
      const creds = await readCredentials();
      // Grandfathering: credentials saved before the cap (or before a
      // downgrade) stay fully usable; only NEW additions are gated.
      const ent = await getEntitlement();
      if (!isPro(ent) && creds.length >= FREE_MAX_CREDENTIALS) {
        throw new DomainError(
          "entitlement_required",
          `The free tier includes ${FREE_MAX_CREDENTIALS} credentials. Upgrade to Pro for unlimited keys — your existing keys stay exactly as they are.`,
        );
      }
      if (creds.some((c) => c.label.toLowerCase() === label.trim().toLowerCase())) {
        throw new DomainError("duplicate_label", `A credential named "${label.trim()}" already exists.`);
      }
      const validation = getAdapter(provider).validateConfiguration(apiKey.trim());
      if (validation) throw new DomainError("invalid_input", validation.message);
      const rec = {
        id: newCredentialId(),
        label: label.trim(),
        provider,
        apiKey: apiKey.trim(),
        maskedHint: maskApiKey(provider, apiKey.trim()),
        createdAt: Date.now(),
      };
      await writeCredentials([...creds, rec]);
      return toMeta(rec);
    });
  },

  "cred/delete": (req: Extract<BgRequest, { type: "cred/delete" }>) => {
    const body = requireObject(req, "request");
    const id = requireString(body.id, "Credential id", 128);
    return withExclusiveLock(async () => {
      const creds = await readCredentials();
      const next = creds.filter((c) => c.id !== id);
      if (next.length === creds.length) {
        throw new DomainError("not_found", "Credential not found.");
      }
      await writeCredentials(next);
      return { ok: true };
    });
  },

  "catalog/list": async () => listProviderCatalog(),

  "test/run": async (req: Extract<BgRequest, { type: "test/run" }>) => {
    const body = requireObject(req, "request");
    const spec = requireObject(body.spec, "Test spec");
    const credentialId = requireString(spec.credentialId, "Credential id", 128);
    if (spec.model !== undefined && typeof spec.model !== "string") {
      throw new DomainError("invalid_input", "Model must be a string.");
    }
    if (spec.prompt !== undefined && (typeof spec.prompt !== "string" || spec.prompt.length > 500)) {
      throw new DomainError("invalid_input", "Prompt must be a string of at most 500 characters.");
    }
    const model = typeof spec.model === "string" && spec.model ? spec.model : "";

    // Read outside the lock — the network call must never block writes.
    const generationAtStart = dataGeneration;
    const creds = await readCredentials();
    const cred = creds.find((c) => c.id === credentialId);
    if (!cred) throw new DomainError("not_found", "Credential not found.");
    const adapter = getAdapter(cred.provider);
    const resolvedModel = model || adapter.defaultModel();
    const prompt =
      typeof spec.prompt === "string" && spec.prompt.length > 0
        ? spec.prompt
        : "Reply with the single word OK.";

    const outcome: TestOutcome = await adapter.sendTestRequest(
      {
        apiKey: cred.apiKey,
        model: resolvedModel,
        prompt: prompt.slice(0, 500),
        maxTokens: clampInt(typeof spec.maxTokens === "number" ? spec.maxTokens : 16, 1, 512),
        timeoutMs: clampInt(typeof spec.timeoutMs === "number" ? spec.timeoutMs : 20_000, 1_000, 25_000),
      },
      (usage) => estimateCost(cred.provider, resolvedModel, usage),
    );

    // Exactly one usage event per completed request: journal first (survives a
    // worker reclaim), then write under the lock against FRESH state, then clear.
    // If the user wiped all data while the request was in flight, the outcome is
    // returned but nothing is recorded for data that no longer exists.
    const event = eventFromOutcome(outcome, cred.id, resolvedModel);
    await journalEvent(event);
    await withExclusiveLock(async () => {
      if (dataGeneration !== generationAtStart) {
        await clearEventJournal();
        return;
      }
      await appendEventsUnsafe([event]);
      const fresh = await readCredentials();
      if (fresh.some((c) => c.id === cred.id)) {
        await writeCredentials(
          fresh.map((c) =>
            c.id === cred.id
              ? {
                  ...c,
                  lastTestedAt: outcome.testedAt,
                  lastTestStatus: outcome.ok ? ("success" as const) : ("failure" as const),
                }
              : c,
          ),
        );
      }
    });
    await clearEventJournal();
    // Outcome carries metadata only — no key material, no response bodies.
    return outcome;
  },

  "dashboard/snapshot": async (req: Extract<BgRequest, { type: "dashboard/snapshot" }>) => {
    const body = requireObject(req, "request");
    if (!isRangeKey(body.range)) {
      throw new DomainError("invalid_input", "Unknown time range.");
    }
    if (
      body.credentialId !== null &&
      body.credentialId !== undefined &&
      typeof body.credentialId !== "string"
    ) {
      throw new DomainError("invalid_input", "Invalid credential selection.");
    }
    // Reading the dashboard counts as user activity for auto-lock.
    if (await isUnlocked()) await touchActivity();
    // Lazy license revalidation: user-initiated (popup open), no timers.
    const entitlement = await revalidateIfNeeded();
    if (!isRangeAllowed(body.range as RangeKey, entitlement)) {
      throw new DomainError(
        "entitlement_required",
        "30-day and all-time views are part of AI Keychain Pro.",
      );
    }
    const [creds, events, settings] = await Promise.all([
      readCredentials(),
      loadEvents(),
      getSettings(),
    ]);
    const snapshot = buildSnapshot(
      creds.map(toMeta),
      events,
      settings,
      body.range as RangeKey,
      (body.credentialId as string | null) ?? null,
      entitlement,
    );
    // Suppress Watch/Healthy repeats (24h) — Need to Know / Needs Attention
    // always surface. Seen-map lives in memory-backed session storage.
    const seen = (await session().get<Record<string, number>>(SEEN_INSIGHTS_KEY)) ?? {};
    const { insights, seen: nextSeen } = applyRepeatSuppression(
      snapshot.insights,
      seen,
      Date.now(),
    );
    snapshot.insights = insights;
    await session().set(SEEN_INSIGHTS_KEY, nextSeen);
    return snapshot;
  },

  "settings/get": async () => getSettings(),

  "premium/status": async () => {
    const ent = await getEntitlement();
    // The license key itself never enters renderer memory — only its state.
    return { tier: ent.tier, status: ent.status };
  },

  "premium/activate": async (req: Extract<BgRequest, { type: "premium/activate" }>) => {
    const body = requireObject(req, "request");
    const licenseKey = requireString(body.licenseKey, "License key", 200);
    return activateLicense(licenseKey);
  },

  "premium/deactivate": async () => deactivateLicense(),

  "settings/set": async (req: Extract<BgRequest, { type: "settings/set" }>) => {
    const body = requireObject(req, "request");
    const patch = requireObject(body.patch, "Settings patch");
    const allowed: Partial<ExtensionSettings> = {};
    for (const key of Object.keys(patch)) {
      if (key !== "autoLockMinutes") {
        throw new DomainError("invalid_input", `Unknown setting "${key}".`);
      }
    }
    if (patch.autoLockMinutes !== undefined) {
      const v = patch.autoLockMinutes;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1440) {
        throw new DomainError("invalid_input", "Auto-lock must be between 0 and 1440 minutes.");
      }
      allowed.autoLockMinutes = Math.round(v);
    }
    await setSettings(allowed);
    return getSettings();
  },

  "data/clearAnalytics": async () => {
    await withExclusiveLock(async () => {
      await clearAnalytics();
    });
    return { ok: true };
  },

  "data/deleteAll": async () => {
    await withExclusiveLock(async () => {
      dataGeneration += 1; // fence out in-flight test completions
      await lockVault();
      await clearAnalytics();
      await chrome.storage.local.clear();
      await chrome.storage.session.clear();
    });
    return { ok: true };
  },
};

// ------------------------------------------------------------------ helpers

function toMeta(c: CredentialMeta): CredentialMeta {
  return {
    id: c.id,
    label: c.label,
    provider: c.provider,
    maskedHint: c.maskedHint,
    createdAt: c.createdAt,
    ...(c.lastTestedAt !== undefined ? { lastTestedAt: c.lastTestedAt } : {}),
    ...(c.lastTestStatus !== undefined ? { lastTestStatus: c.lastTestStatus } : {}),
  };
}

function clampInt(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}

function rangeSpanMs(range: RangeKey): number | null {
  switch (range) {
    case "24h":
      return 24 * 3_600_000;
    case "7d":
      return 7 * 86_400_000;
    case "30d":
      return 30 * 86_400_000;
    default:
      return null; // 'all' — no comparison window
  }
}

// --------------------------------------------------------------- snapshot

export function buildSnapshot(
  creds: CredentialMeta[],
  events: UsageEvent[],
  settings: ExtensionSettings,
  range: RangeKey,
  selectedCredentialId: string | null,
  entitlement: EntitlementRecord = { tier: "free", status: "inactive" },
): DashboardSnapshot {
  const now = Date.now();
  const spanMs = rangeSpanMs(range);

  const currentEvents = inWindow(events, range, now);
  let previousEvents: UsageEvent[] = [];
  if (spanMs !== null) {
    const prevStart = now - 2 * spanMs;
    previousEvents = events.filter(
      (e) => e.timestamp >= prevStart && e.timestamp < now - spanMs,
    );
  }

  const series = buildSeries(currentEvents, range, now);

  const globalData: GlobalDashboardData = {
    range,
    hasAnyDataEver: events.length > 0,
    summary: summarize(currentEvents),
    previousSummary: previousEvents.length > 0 ? summarize(previousEvents) : null,
    series,
    providerBreakdown: breakdown(currentEvents, (e) => e.provider),
    modelBreakdown: breakdown(currentEvents, (e) => e.model ?? "(unknown)"),
    recentActivity: recentActivity(events, 8).map((a) => ({
      ...a,
      credentialLabel: creds.find((c) => c.id === a.credentialId)?.label,
    })),
    credentialsWithoutPricing: modelsWithoutPricing(currentEvents),
  };

  const selected = selectedCredentialId
    ? creds.find((c) => c.id === selectedCredentialId)
    : undefined;
  let credentialData: DashboardSnapshot["credential"] = null;
  if (selected) {
    const cur = currentEvents.filter((e) => e.credentialId === selected.id);
    const prev = previousEvents.filter((e) => e.credentialId === selected.id);
    const lastTest =
      selected.lastTestedAt !== undefined
        ? { at: selected.lastTestedAt, ok: selected.lastTestStatus === "success" }
        : undefined;
    credentialData = {
      credential: selected,
      range,
      summary: summarize(cur),
      previousSummary: prev.length > 0 ? summarize(prev) : null,
      series: buildSeries(cur, range, now),
      modelBreakdown: breakdown(cur, (e) => e.model ?? "(unknown)"),
      recentFailures: recentActivity(cur, 5).filter((r) => r.status === "failure"),
      ...(lastTest ? { lastTest } : {}),
    };
  }

  const insightsForContext = selected
    ? generateInsights({
        range,
        current: currentEvents.filter((e) => e.credentialId === selected.id),
        previous: previousEvents.filter((e) => e.credentialId === selected.id),
        now,
        scopeLabel: `"${selected.label}"`,
        credential: selected,
        scope: { credentialId: selected.id },
      })
    : generateInsights({
        range,
        current: currentEvents,
        previous: previousEvents,
        now,
        scopeLabel: "all credentials",
        scope: {},
      });

  return {
    premium: { tier: entitlement.tier },
    credentials: creds,
    selectedCredentialId: selectedCredentialId,
    range,
    global: globalData,
    ...(credentialData ? { credential: credentialData } : { credential: null }),
    insights: insightsForContext.filter((i) => layerAllowed(i.layer, entitlement)),
    settings: settings ?? { autoLockMinutes: 30 },
  };
}
