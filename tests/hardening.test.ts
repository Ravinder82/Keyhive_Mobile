/**
 * Hardening tests from the Quality Inspector's Phase R1 findings:
 * write serialization, input validation, true domain error codes,
 * event journaling/idempotency, KDF clamping, and body-size caps.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { call } from "./router-helpers";
import { createVault, lockVault, unlockVault } from "../src/core/vault";
import { appendEvents, loadEvents } from "../src/analytics/store";
import { eventFromOutcome } from "../src/analytics/events";
import { reconcilePendingEvents } from "../src/background/main";
import { readJsonBody } from "../src/providers/http";
import { mockStorage } from "./setup";
import type { TestOutcome, UsageEvent } from "../src/shared/types";

const PW = "hardening-pass-1";

async function setupUnlockedVaultWithCred(): Promise<string> {
  await createVault(PW);
  const res = (await call({
    type: "cred/add",
    label: "Key A",
    provider: "openai",
    apiKey: "sk-hardening1234567890abcd",
  })) as { ok: boolean; data?: { id: string } };
  if (!res.ok || !res.data) throw new Error("cred/add failed in test setup");
  return res.data.id;
}

function outcome(): TestOutcome {
  return {
    ok: false,
    provider: "openai",
    model: "gpt-4o-mini",
    latencyMs: 42,
    error: { category: "auth_invalid", message: "Authentication failed — the API key was rejected.", retryable: false },
    testedAt: Date.now(),
  };
}

function evt(id: string, ts = Date.now()): UsageEvent {
  return {
    eventId: id,
    schemaVersion: 1,
    timestamp: ts,
    provider: "openai",
    model: "gpt-4o-mini",
    credentialId: "c1",
    status: "success",
    latencyMs: 100,
    costAvailable: false,
    usageReported: false,
    testKind: "manual-test",
  };
}

beforeEach(() => {
  mockStorage.local.clear();
  mockStorage.session.clear();
  vi.unstubAllGlobals();
});

describe("R1-01 write serialization", () => {
  it("a credential added during an in-flight test request survives", async () => {
    const credId = await setupUnlockedVaultWithCred();

    // Slow provider call: the request is in flight while we mutate the vault.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => setTimeout(() => resolve(new Response("{}", { status: 401 })), 60))),
    );
    const testPromise = call({ type: "test/run", spec: { credentialId: credId, model: "gpt-4o-mini" } });
    const addRes = await call({
      type: "cred/add",
      label: "Key B added mid-flight",
      provider: "openai",
      apiKey: "sk-midflight1234567890ab",
    });
    expect(addRes.ok).toBe(true);
    const testRes = await testPromise;
    expect(testRes.ok).toBe(true);

    const list = (await call({ type: "cred/list" })) as { ok: boolean; data: { label: string }[] };
    expect(list.data.map((c) => c.label).sort()).toEqual(["Key A", "Key B added mid-flight"]);
  });

  it("parallel adds with the same label: exactly one wins", async () => {
    await createVault(PW);
    const [a, b] = await Promise.all([
      call({ type: "cred/add", label: "Dup", provider: "openai", apiKey: "sk-parallel1234567890abc" }),
      call({ type: "cred/add", label: "Dup", provider: "openai", apiKey: "sk-parallel1234567890abd" }),
    ]);
    const codes = [a, b].map((r) => (r as { ok: boolean; code?: string }).ok);
    expect(codes.filter(Boolean)).toHaveLength(1);
    const list = (await call({ type: "cred/list" })) as { data: unknown[] };
    expect(list.data).toHaveLength(1);
  });
});

describe("R1-02 pending-event journal", () => {
  it("replays a journaled event exactly once across restarts", async () => {
    await createVault(PW);
    const event = eventFromOutcome(outcome(), "cred-1", "gpt-4o-mini");
    mockStorage.session.set("session.pendingUsageEvent.v1", event);

    await reconcilePendingEvents();
    expect((await loadEvents()).map((e) => e.eventId)).toEqual([event.eventId]);
    expect(mockStorage.session.has("session.pendingUsageEvent.v1")).toBe(false);

    // Replay after a crash-between-append-and-clear must not double-count.
    mockStorage.session.set("session.pendingUsageEvent.v1", event);
    await reconcilePendingEvents();
    expect(await loadEvents()).toHaveLength(1);
  });

  it("appendEvents is idempotent per eventId", async () => {
    const e = evt("dup-1");
    await appendEvents([e]);
    await appendEvents([e]);
    expect((await loadEvents()).map((x) => x.eventId)).toEqual(["dup-1"]);
  });
});

describe("R1-03 domain error codes", () => {
  it("vault_exists on second create", async () => {
    await createVault(PW);
    const res = await call({ type: "vault/create", password: PW + "x" });
    expect(res).toMatchObject({ ok: false, code: "vault_exists" });
  });

  it("weak_password for short passwords", async () => {
    const res = await call({ type: "vault/create", password: "short" });
    expect(res).toMatchObject({ ok: false, code: "weak_password" });
  });

  it("no_vault when unlocking before creation", async () => {
    const res = await call({ type: "vault/unlock", password: PW });
    expect(res).toMatchObject({ ok: false, code: "no_vault" });
  });

  it("corrupt_vault for a structurally broken envelope", async () => {
    await createVault(PW);
    await lockVault();
    mockStorage.local.set("vault.envelope.v1", { v: 1 });
    const res = await call({ type: "vault/unlock", password: PW });
    expect(res).toMatchObject({ ok: false, code: "corrupt_vault" });
  });

  it("corrupt_vault when KDF iterations were tampered", async () => {
    await createVault(PW);
    await lockVault();
    const env = mockStorage.local.get("vault.envelope.v1") as { kdf: { iterations: number } };
    env.kdf.iterations = 500; // absurdly low — tampered
    mockStorage.local.set("vault.envelope.v1", env);
    const res = await call({ type: "vault/unlock", password: PW });
    expect(res).toMatchObject({ ok: false, code: "corrupt_vault" });
    await expect(unlockVault(PW)).rejects.toThrow();
  });
});

describe("R1-06 router input validation", () => {
  it("rejects test/run without a spec", async () => {
    const res = await call({ type: "test/run" });
    expect(res).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("rejects unknown snapshot ranges", async () => {
    await createVault(PW);
    const res = await call({ type: "dashboard/snapshot", range: "hax", credentialId: null });
    expect(res).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("rejects unknown settings keys and non-finite values", async () => {
    await createVault(PW);
    expect(await call({ type: "settings/set", patch: { evil: true } })).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
    expect(await call({ type: "settings/set", patch: { autoLockMinutes: Number.NaN } })).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
    expect(await call({ type: "settings/set", patch: { autoLockMinutes: 99999 } })).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
  });

  it("accepts a valid settings patch", async () => {
    await createVault(PW);
    const res = await call({ type: "settings/set", patch: { autoLockMinutes: 15 } });
    expect(res).toMatchObject({ ok: true, data: { autoLockMinutes: 15 } });
  });
});

describe("R1-08 body-size cap and usage distinction", () => {
  it("refuses oversized response bodies instead of exhausting memory", async () => {
    const big = new Response("x".repeat(11 * 1024 * 1024), { status: 200 });
    expect(await readJsonBody(big)).toBeUndefined();
    const ok = new Response(JSON.stringify({ fine: true }), { status: 200 });
    expect(await readJsonBody(ok)).toEqual({ fine: true });
  });

  it("marks events without provider usage as usageReported:false", () => {
    const noUsage = eventFromOutcome(
      { ...outcome(), ok: true, error: undefined },
      "c1",
      "gpt-4o-mini",
    );
    expect(noUsage.usageReported).toBe(false);
    const withUsage = eventFromOutcome(
      { ...outcome(), ok: true, error: undefined, usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } },
      "c1",
      "gpt-4o-mini",
    );
    expect(withUsage.usageReported).toBe(true);
  });
});
