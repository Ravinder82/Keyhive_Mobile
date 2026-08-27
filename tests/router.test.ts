/**
 * Message-routing regression tests: drive the REAL background listener
 * registered against the chrome.* mock and assert typed error codes.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createVault, lockVault } from "../src/core/vault";
import { mockStorage } from "./setup";
import { call } from "./router-helpers";

// Importing the background module registers its message router.
await import("../src/background/main");

describe("background message router", () => {
  beforeEach(() => {
    mockStorage.local.clear();
    mockStorage.session.clear();
  });

  it("responds to unknown request types with a typed error", async () => {
    const res = await call({ type: "nope/nope" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("internal");
  });

  it("returns code 'locked' (not 'internal') when the vault is locked", async () => {
    await createVault("router-test-pw-1");
    await lockVault();
    const res = await call({ type: "cred/list" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("locked");
  });

  it("returns code 'wrong_password' from unlock failures", async () => {
    await createVault("router-test-pw-1");
    await lockVault();
    const res = await call({ type: "vault/unlock", password: "totally-wrong" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("wrong_password");
  });

  it("returns a snapshot once unlocked", async () => {
    await createVault("router-test-pw-1");
    const res = await call({ type: "dashboard/snapshot", range: "7d", credentialId: null });
    expect(res.ok).toBe(true);
    expect((res.data as { global: { summary: { requests: number } } }).global.summary.requests).toBe(0);
  });
});
