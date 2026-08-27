import { beforeEach, describe, expect, it, vi } from "vitest";
import { createVault, lockVault, readCredentials, unlockVault, writeCredentials } from "../src/core/vault";
import { appendEvents, loadEvents } from "../src/analytics/store";
import { eventFromOutcome } from "../src/analytics/events";
import { maskApiKey } from "../src/shared/types";
import { mockStorage } from "./setup";
import type { TestOutcome } from "../src/shared/types";

const PW = "security-pass-1";
const SECRET = "sk-proj-SUPERSECRETVALUE-9f2a1b";

describe("security invariants", () => {
  beforeEach(() => {
    mockStorage.local.clear();
    mockStorage.session.clear();
  });

  async function seedVaultWithSecret(): Promise<void> {
    await createVault(PW);
    await writeCredentials([
      {
        id: "cred-1",
        label: "Leaky?",
        provider: "openai",
        apiKey: SECRET,
        maskedHint: maskApiKey("openai", SECRET),
        createdAt: Date.now(),
      },
    ]);
  }

  it("never stores the plaintext API key anywhere on disk", async () => {
    await seedVaultWithSecret();
    const everything = JSON.stringify([...mockStorage.local.entries()]);
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain("SUPERSECRETVALUE");
  });

  it("session key material lives only in memory-backed session storage", async () => {
    await seedVaultWithSecret();
    const localRaw = JSON.stringify([...mockStorage.local.entries()]);
    expect(localRaw).not.toContain("session.derivedKey.v1");
    expect(mockStorage.session.has("session.derivedKey.v1")).toBe(true);
    await lockVault();
    expect(mockStorage.session.has("session.derivedKey.v1")).toBe(false);
  });

  it("masked hints reveal only prefix and last 4 characters", () => {
    const masked = maskApiKey("openai", SECRET);
    expect(masked.startsWith("sk-")).toBe(true);
    expect(masked.endsWith(SECRET.slice(-4))).toBe(true);
    expect(masked).not.toContain("proj");
    expect(masked.length).toBeLessThan(SECRET.length);
  });

  it("analytics events never contain key material or prompts", async () => {
    await seedVaultWithSecret();
    const outcome: TestOutcome = {
      ok: false,
      provider: "openai",
      model: "gpt-4o-mini",
      latencyMs: 123,
      error: { category: "auth_invalid", message: "Authentication failed — the API key was rejected.", retryable: false },
      testedAt: Date.now(),
    };
    await appendEvents([eventFromOutcome(outcome, "cred-1", "gpt-4o-mini")]);
    const raw = JSON.stringify([...mockStorage.local.entries()]);
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain("Reply with");
    const events = await loadEvents();
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0]!)).not.toContain("prompt");
    expect(Object.keys(events[0]!)).not.toContain("apiKey");
  });

  it("sanitized errors never echo provider response bodies", async () => {
    const { openaiAdapter } = await import("../src/providers/openai");
    const leakyBody = { error: { message: `Invalid key ${SECRET} — key was ${SECRET}` } };
    globalThis.fetch = vi.fn(() => new Response(JSON.stringify(leakyBody), { status: 401 })) as never;
    const out = await openaiAdapter.sendTestRequest({
      apiKey: SECRET,
      model: "gpt-4o-mini",
      prompt: "x",
      maxTokens: 5,
      timeoutMs: 1000,
    });
    expect(JSON.stringify(out)).not.toContain(SECRET);
    expect(out.error!.message).toBe("Authentication failed — the API key was rejected.");
  });

  it("persisted vault envelope contains only versioned metadata + ciphertext", async () => {
    await seedVaultWithSecret();
    const env = mockStorage.local.get("vault.envelope.v1") as Record<string, unknown>;
    expect(Object.keys(env).sort()).toEqual([
      "aead",
      "createdAt",
      "ctB64",
      "ivB64",
      "kdf",
      "updatedAt",
      "v",
    ]);
  });

  it("credentials are unreadable while locked", async () => {
    await seedVaultWithSecret();
    await lockVault();
    await expect(readCredentials()).rejects.toThrow(/locked/i);
    await unlockVault(PW);
    expect((await readCredentials())[0]!.apiKey).toBe(SECRET);
  });
});
