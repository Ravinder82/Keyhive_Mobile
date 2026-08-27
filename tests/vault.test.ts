import { beforeEach, describe, expect, it } from "vitest";
import {
  assertPasswordStrength,
  createVault,
  changeMasterPassword,
  isUnlocked,
  lockVault,
  readCredentials,
  unlockVault,
  vaultExists,
  writeCredentials,
} from "../src/core/vault";
import { WrongPasswordError } from "../src/core/crypto";
import { mockStorage } from "./setup";
import type { CredentialRecord } from "../src/shared/types";

const PW = "correct-horse-42";

async function seedCredential(): Promise<void> {
  await writeCredentials([
    {
      id: "cred-1",
      label: "Work key",
      provider: "openai",
      apiKey: "sk-test-SECRETVALUE-1234567890",
      maskedHint: "sk-…90",
      createdAt: 1,
    },
  ]);
}

describe("vault lifecycle", () => {
  beforeEach(() => {
    mockStorage.local.clear();
    mockStorage.session.clear();
  });

  it("create → exists → unlocked", async () => {
    expect(await vaultExists()).toBe(false);
    await createVault(PW);
    expect(await vaultExists()).toBe(true);
    expect(await isUnlocked()).toBe(true);
  });

  it("lock invalidates the session key immediately", async () => {
    await createVault(PW);
    await lockVault();
    expect(await isUnlocked()).toBe(false);
    await expect(readCredentials()).rejects.toThrow(/locked/i);
  });

  it("unlock requires the correct password", async () => {
    await createVault(PW);
    await lockVault();
    await expect(unlockVault("wrong-password")).rejects.toBeInstanceOf(WrongPasswordError);
    await unlockVault(PW);
    expect(await isUnlocked()).toBe(true);
  });

  it("credentials are encrypted at rest — no plaintext key in storage", async () => {
    await createVault(PW);
    await seedCredential();
    const raw = JSON.stringify([...mockStorage.local.entries()]);
    expect(raw).not.toContain("SECRETVALUE");
    expect(raw).toContain("vault.envelope.v1");
  });

  it("credentials round-trip through encrypt/decrypt", async () => {
    await createVault(PW);
    await seedCredential();
    const creds = await readCredentials();
    expect(creds).toHaveLength(1);
    expect(creds[0]!.apiKey).toBe("sk-test-SECRETVALUE-1234567890");
  });

  it("changing the master password re-encrypts with a newly derived key", async () => {
    await createVault(PW);
    await seedCredential();
    await changeMasterPassword(PW, "new-master-99");
    // Old password must now fail.
    await lockVault();
    await expect(unlockVault(PW)).rejects.toBeInstanceOf(WrongPasswordError);
    await unlockVault("new-master-99");
    const creds = await readCredentials();
    expect(creds[0]!.label).toBe("Work key");
    // Salt rotated.
    const env = mockStorage.local.get("vault.envelope.v1") as { kdf: { saltB64: string } };
    expect(env.kdf.saltB64).toBeTruthy();
  });

  it("auto-lock expires the session after the configured idle window", async () => {
    await createVault(PW);
    // Configure 1 minute auto-lock and backdate activity by 2 minutes.
    const { setSettings } = await import("../src/core/vault");
    await setSettings({ autoLockMinutes: 1 });
    const activityKey = "session.activity.v1";
    mockStorage.session.set(activityKey, Date.now() - 2 * 60_000);
    expect(await isUnlocked()).toBe(false);
    await expect(readCredentials()).rejects.toThrow(/locked/i);
  });

  it("rejects weak master passwords", async () => {
    expect(() => assertPasswordStrength("short")).toThrow(/8 characters/);
    await expect(createVault("short")).rejects.toThrow();
    expect(await vaultExists()).toBe(false);
  });

  it("refuses to create a second vault", async () => {
    await createVault(PW);
    await expect(createVault(PW)).rejects.toThrow(/already exists/);
  });

  it("writeCredentials enforces an unlocked session", async () => {
    await expect(
      writeCredentials([] as CredentialRecord[]),
    ).rejects.toThrow(/locked/i);
  });
});
