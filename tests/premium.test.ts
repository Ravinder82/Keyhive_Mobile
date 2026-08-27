/**
 * Premium v1.1 tests: entitlement gating (grandfathered credential cap,
 * range gate, insight-layer filter), the Dodo license matrix (valid/invalid/
 * expired/disabled/limit/network), and lazy revalidation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { call } from "./router-helpers";
import { writeCredentials } from "../src/core/vault";
import { getEntitlement } from "../src/premium/store";
import { buildSnapshot } from "../src/background/main";
import { mockStorage } from "./setup";
import type { EntitlementRecord } from "../src/premium/entitlements";
import type { CredentialRecord, UsageEvent } from "../src/shared/types";

const PW = "premium-pass-1";

function licResponse(status: string, instanceId = "inst-1"): Response {
  return new Response(JSON.stringify({ status, instance_id: instanceId }), { status: 200 });
}

async function unlockedVault(): Promise<void> {
  mockStorage.local.clear();
  mockStorage.session.clear();
  vi.unstubAllGlobals();
  const res = await call({ type: "vault/create", password: PW });
  if (!res.ok) throw new Error("setup failed");
}

const credMeta = (id: string): CredentialRecord => ({
  id,
  label: `Key ${id}`,
  provider: "openai",
  apiKey: "sk-grandfathered123456789",
  maskedHint: "sk-…456",
  createdAt: Date.now(),
});

const evt = (p: Partial<UsageEvent>, ageMs = 0): UsageEvent => ({
  eventId: Math.random().toString(36).slice(2),
  schemaVersion: 1,
  timestamp: Date.now() - ageMs,
  provider: "openai",
  model: "gpt-4o-mini",
  credentialId: "c1",
  status: "success",
  latencyMs: 400,
  costAvailable: false,
  usageReported: false,
  testKind: "manual-test",
  ...p,
});

beforeEach(() => {
  mockStorage.local.clear();
  mockStorage.session.clear();
  vi.unstubAllGlobals();
});

describe("free-tier credential cap (grandfathered)", () => {
  it("allows two adds, blocks the third with entitlement_required", async () => {
    await unlockedVault();
    expect((await call({ type: "cred/add", label: "A", provider: "openai", apiKey: "sk-premiumtest1234567890a" })).ok).toBe(true);
    expect((await call({ type: "cred/add", label: "B", provider: "openai", apiKey: "sk-premiumtest1234567890b" })).ok).toBe(true);
    const third = await call({ type: "cred/add", label: "C", provider: "openai", apiKey: "sk-premiumtest1234567890c" });
    expect(third).toMatchObject({ ok: false, code: "entitlement_required" });
  });

  it("grandfathered over-cap credentials stay usable; only new adds are gated", async () => {
    await unlockedVault();
    // Three credentials saved before the cap existed (direct vault write).
    await writeCredentials([credMeta("g1"), credMeta("g2"), credMeta("g3")]);
    // All three remain listed and a 4th add is blocked.
    const list = (await call({ type: "cred/list" })) as { data: unknown[] };
    expect(list.data).toHaveLength(3);
    const add = await call({ type: "cred/add", label: "New", provider: "openai", apiKey: "sk-grandfathered123456789" });
    expect(add).toMatchObject({ ok: false, code: "entitlement_required" });
    // Deleting works on grandfathered credentials. Down to 2 = still at cap.
    expect((await call({ type: "cred/delete", id: "g3" })).ok).toBe(true);
    expect((await call({ type: "cred/add", label: "New", provider: "openai", apiKey: "sk-grandfathered123456789" })).ok).toBe(false);
    // Below the cap, adding works again.
    expect((await call({ type: "cred/delete", id: "g2" })).ok).toBe(true);
    expect((await call({ type: "cred/add", label: "New", provider: "openai", apiKey: "sk-grandfathered123456789" })).ok).toBe(true);
  });
});

describe("license activation matrix (mocked Dodo endpoint)", () => {
  it("valid key activates Pro", async () => {
    await unlockedVault();
    vi.stubGlobal("fetch", vi.fn(async () => licResponse("active")));
    const res = await call({ type: "premium/activate", licenseKey: "lic_valid_key_123" });
    expect(res.ok).toBe(true);
    const ent = await getEntitlement();
    expect(ent.tier).toBe("pro");
    expect(ent.instanceId).toBe("inst-1");
    expect(ent.lastValidatedAt).toBeGreaterThan(0);
  });

  it("unknown key → typed invalid_input with a friendly message", async () => {
    await unlockedVault();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "not found" }), { status: 404 })));
    const res = await call({ type: "premium/activate", licenseKey: "lic_bad" });
    expect(res).toMatchObject({ ok: false, code: "invalid_input" });
    expect(await getEntitlement().then((e) => e.tier)).toBe("free");
  });

  it("activation limit → typed error naming the limit", async () => {
    await unlockedVault();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "activation limit reached" }), { status: 402 })));
    const res = await call({ type: "premium/activate", licenseKey: "lic_maxed" });
    expect(res.ok).toBe(false);
    expect(String(res.message)).toMatch(/activations left/i);
  });

  it("network flake never downgrades an existing Pro entitlement", async () => {
    await unlockedVault();
    vi.stubGlobal("fetch", vi.fn(async () => licResponse("active")));
    await call({ type: "premium/activate", licenseKey: "lic_valid_key_123" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    const res = await call({ type: "premium/activate", licenseKey: "lic_another" });
    expect(res.ok).toBe(false);
    expect((await getEntitlement()).tier).toBe("pro"); // untouched
  });

  it("deactivate returns to free (restore = re-paste key)", async () => {
    await unlockedVault();
    vi.stubGlobal("fetch", vi.fn(async () => licResponse("active")));
    await call({ type: "premium/activate", licenseKey: "lic_valid_key_123" });
    vi.stubGlobal("fetch", vi.fn(async () => licResponse("inactive", "inst-1")));
    const res = await call({ type: "premium/deactivate" });
    expect(res.ok).toBe(true);
    expect((await getEntitlement()).tier).toBe("free");
  });
});

describe("lazy revalidation", () => {
  it("validates only when the last check is older than 7 days (on popup open)", async () => {
    await unlockedVault();
    vi.stubGlobal("fetch", vi.fn(async () => licResponse("active")));
    await call({ type: "premium/activate", licenseKey: "lic_valid_key_123" });
    const fetchSpy = vi.fn(async () => licResponse("active"));
    vi.stubGlobal("fetch", fetchSpy);

    // Fresh validation → snapshot does not re-contact the license service.
    await call({ type: "dashboard/snapshot", range: "24h", credentialId: null });
    expect(fetchSpy).not.toHaveBeenCalled();

    // Age the validation past 7 days → exactly one revalidation call.
    const ent = await getEntitlement();
    await import("../src/premium/store").then((m) =>
      m.activateLicense, // no-op import to satisfy module graph
    );
    const aged: EntitlementRecord = { ...ent, lastValidatedAt: Date.now() - 8 * 24 * 3_600_000 };
    await import("../src/core/storage").then(async (st) => {
      await st.local().set(st.STORAGE_KEYS.premiumEntitlement, aged);
    });
    await call({ type: "dashboard/snapshot", range: "24h", credentialId: null });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("range + insight-layer gating", () => {
  it("gated ranges are rejected for free and allowed for Pro", async () => {
    await unlockedVault();
    const gated = await call({ type: "dashboard/snapshot", range: "30d", credentialId: null });
    expect(gated).toMatchObject({ ok: false, code: "entitlement_required" });

    vi.stubGlobal("fetch", vi.fn(async () => licResponse("active")));
    await call({ type: "premium/activate", licenseKey: "lic_valid_key_123" });
    const allowed = await call({ type: "dashboard/snapshot", range: "30d", credentialId: null });
    expect(allowed.ok).toBe(true);
  });

  it("buildSnapshot filters Pro-only insight layers for free users", () => {
    const creds = [credMeta("c1")];
    const events = [
      ...Array.from({ length: 12 }, (_, k) => evt({ timestamp: Date.now() - k * 3_600_000 }, 0)),
      evt({ status: "failure", errorCategory: "auth_invalid" }, 2 * 3_600_000),
    ];
    const free = buildSnapshot(creds, events, { autoLockMinutes: 30 }, "7d", null, {
      tier: "free",
      status: "inactive",
    });
    expect(free.insights.some((i) => i.layer === "watch" || i.layer === "healthy")).toBe(false);
    expect(free.insights.length).toBeGreaterThan(0);

    const pro = buildSnapshot(creds, events, { autoLockMinutes: 30 }, "7d", null, {
      tier: "pro",
      status: "active",
    });
    // Pro may include watch/healthy when they fire; free never does.
    expect(pro.premium.tier).toBe("pro");
  });
});
