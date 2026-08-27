/**
 * R2-02: password derivation must happen OUTSIDE the exclusive mutex, so a
 * slow (or wrong-password) unlock never delays other operations.
 * R2-03: data/deleteAll must fence in-flight test completions.
 *
 * Both behaviours are verified with instrumented mocks: deriveKey gets a
 * controllable delay, and the mutex reports its concurrency.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  deriveMs: 0,
  activeLocks: 0,
  maxActiveLocks: 0,
  lockDurations: [] as number[],
}));

vi.mock("../src/core/crypto", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/core/crypto")>();
  return {
    ...mod,
    deriveKey: async (...args: Parameters<typeof mod.deriveKey>) => {
      if (h.deriveMs > 0) await new Promise((r) => setTimeout(r, h.deriveMs));
      return mod.deriveKey(...args);
    },
  };
});

vi.mock("../src/core/mutex", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/core/mutex")>();
  // Instrumented but STILL serializing: keep the original promise-chaining
  // semantics, only add concurrency tracking around the critical section.
  let tail: Promise<unknown> = Promise.resolve();
  return {
    ...mod,
    withExclusiveLock: async <T>(fn: () => Promise<T>): Promise<T> => {
      const run = tail.then(fn, fn);
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      h.activeLocks += 1;
      h.maxActiveLocks = Math.max(h.maxActiveLocks, h.activeLocks);
      const t0 = Date.now();
      try {
        return await run;
      } finally {
        h.activeLocks -= 1;
        h.lockDurations.push(Date.now() - t0);
      }
    },
  };
});

import { call } from "./router-helpers";
import { loadEvents } from "../src/analytics/store";
import {
  changeMasterPassword,
  commitPasswordChange,
  commitUnlock,
  createVault,
  isUnlocked,
  lockVault,
  preparePasswordChange,
  prepareUnlock,
  readCredentials,
  unlockVault,
  writeCredentials,
} from "../src/core/vault";
import { mockStorage } from "./setup";
await import("../src/background/main");

const PW = "derive-then-lock-pw";

beforeEach(() => {
  mockStorage.local.clear();
  mockStorage.session.clear();
  h.deriveMs = 0;
  h.activeLocks = 0;
  h.maxActiveLocks = 0;
  h.lockDurations = [];
  vi.unstubAllGlobals();
});

describe("R2-02 derive-then-lock", () => {
  it("a locked operation proceeds while unlock derivation is still running", async () => {
    await call({ type: "vault/create", password: PW });
    await call({ type: "vault/lock" });

    h.deriveMs = 400; // simulated slow KDF
    const unlockPromise = call({ type: "vault/unlock", password: PW });

    // While the (unlocked-section) derivation is running, a locked operation
    // must complete without waiting for the KDF.
    const t0 = Date.now();
    const clear = await call({ type: "data/clearAnalytics" });
    const clearMs = Date.now() - t0;

    const unlock = await unlockPromise;
    expect(unlock.ok).toBe(true);
    expect(clear.ok).toBe(true);
    expect(clearMs).toBeLessThan(250); // did not wait for the 400ms KDF
    expect(h.maxActiveLocks).toBeLessThanOrEqual(1); // exclusivity preserved
  }, 20_000);

  it("a wrong-password unlock never takes the lock at all", async () => {
    await call({ type: "vault/create", password: PW });
    await call({ type: "vault/lock" });
    h.deriveMs = 250;

    const before = h.lockDurations.length;
    const res = await call({ type: "vault/unlock", password: "definitely-wrong" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("wrong_password");
    // prepareUnlock failed before commitUnlock — no lock section ran for it.
    expect(h.lockDurations.length).toBe(before);
  }, 20_000);
});

describe("R3 commit-race fences", () => {
  it("commitUnlock aborts when the envelope changed during derivation", async () => {
    await createVault(PW);
    await lockVault();
    const prepared = await prepareUnlock(PW);
    // A concurrent password change lands while the KDF is "running".
    await changeMasterPassword(PW, PW + "-rotated");
    await expect(commitUnlock(prepared)).rejects.toThrow();
    // The stale prepared key was NOT installed: the session left by the
    // concurrent password change still decrypts the current envelope.
    const creds = await readCredentials();
    expect(creds).toEqual([]);
  }, 20_000);

  it("commitUnlock aborts when data was deleted during derivation", async () => {
    await createVault(PW);
    await lockVault();
    const prepared = await prepareUnlock(PW);
    mockStorage.local.clear();
    mockStorage.session.clear();
    await expect(commitUnlock(prepared)).rejects.toThrow();
    expect(mockStorage.local.has("vault.envelope.v1")).toBe(false);
  }, 20_000);

  it("commitPasswordChange aborts when the envelope changed during re-encryption", async () => {
    await createVault(PW);
    await writeCredentials([
      { id: "x", label: "L", provider: "openai", apiKey: "sk-race1234567890abcd", maskedHint: "sk-…cd", createdAt: 1 },
    ]);
    const prepared = await preparePasswordChange(PW, PW + "-new");
    // A concurrent credential add (read-modify-write) lands after the prepare.
    const concurrent = await readCredentials();
    await writeCredentials([
      ...concurrent,
      { id: "y", label: "L2", provider: "openai", apiKey: "sk-race1234567890abce", maskedHint: "sk-…ce", createdAt: 2 },
    ]);
    await expect(commitPasswordChange(prepared)).rejects.toThrow();
    // The old password still opens the (unchanged) vault.
    await unlockVault(PW);
    const creds = await readCredentials();
    expect(creds.map((c) => c.id).sort()).toEqual(["x", "y"]);
  }, 20_000);
});

describe("R2-03 deleteAll fencing", () => {
  it("an in-flight test that finishes after deleteAll records nothing", async () => {
    await call({ type: "vault/create", password: PW });
    const add = await call({
      type: "cred/add",
      label: "Fence key",
      provider: "openai",
      apiKey: "sk-fencetest1234567890ab",
    });
    const credId = (add as { data: { id: string } }).data.id;

    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => setTimeout(() => resolve(new Response("{}", { status: 401 })), 80))),
    );
    const testPromise = call({ type: "test/run", spec: { credentialId: credId, model: "gpt-4o-mini" } });
    // Let the handler get past its initial credential read so the wipe lands
    // during the network call — the exact window the generation fence covers.
    await new Promise((r) => setTimeout(r, 30));
    const wipe = await call({ type: "data/deleteAll" });
    expect(wipe.ok).toBe(true);
    const test = await testPromise;
    // Both resolutions are honest: the fenced path returns the outcome, and a
    // wipe that lands even earlier surfaces "locked". The invariant is that
    // nothing is recorded for data that no longer exists.
    expect(test.ok === true || test.code === "locked").toBe(true);

    expect(await loadEvents()).toHaveLength(0); // …but nothing was recorded
    const status = await call({ type: "vault/status" });
    expect((status as { data: { exists: boolean } }).data.exists).toBe(false);
  }, 20_000);
});
