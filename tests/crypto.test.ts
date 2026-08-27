import { describe, expect, it } from "vitest";
import {
  CorruptVaultError,
  WrongPasswordError,
  decryptWithKey,
  encryptWithKey,
  fromB64,
  importKeyRaw,
  exportKeyRaw,
  openEnvelope,
  resealEnvelope,
  sealEnvelope,
} from "../src/core/crypto";

describe("vault cryptography", () => {
  it("seals and opens a payload round-trip", async () => {
    const env = await sealEnvelope("correct horse battery", '{"credentials":[]}');
    expect(env.v).toBe(1);
    expect(env.kdf.alg).toBe("PBKDF2-SHA256");
    expect(env.aead).toBe("AES-256-GCM");
    const pt = await openEnvelope("correct horse battery", env);
    expect(pt).toBe('{"credentials":[]}');
  });

  it("rejects a wrong password with WrongPasswordError", async () => {
    const env = await sealEnvelope("password-one", "secret payload");
    await expect(openEnvelope("password-two", env)).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it("uses a unique random salt per vault", async () => {
    const a = await sealEnvelope("same-password", "x");
    const b = await sealEnvelope("same-password", "x");
    expect(a.kdf.saltB64).not.toBe(b.kdf.saltB64);
    expect(a.ctB64).not.toBe(b.ctB64);
  });

  it("produces different ciphertext for identical plaintexts under fresh envelopes", async () => {
    const a = await sealEnvelope("pw", "identical");
    const b = await sealEnvelope("pw", "identical");
    expect(a.ivB64).not.toBe(b.ivB64);
    expect(a.ctB64).not.toBe(b.ctB64);
  });

  it("reseals (password change) with a new salt and new key material", async () => {
    const env = await sealEnvelope("old-password", '{"credentials":[1,2,3]}');
    const next = await resealEnvelope("old-password", "new-password", env);
    expect(next.kdf.saltB64).not.toBe(env.kdf.saltB64);
    expect(next.createdAt).toBe(env.createdAt);
    await expect(openEnvelope("old-password", next)).rejects.toBeInstanceOf(WrongPasswordError);
    const pt = await openEnvelope("new-password", next);
    expect(pt).toBe('{"credentials":[1,2,3]}');
  });

  it("detects a corrupted envelope", async () => {
    const env = await sealEnvelope("pw", "payload");
    const corrupted = { ...env, ctB64: env.ctB64.slice(0, -4) + "AAAA" };
    await expect(openEnvelope("pw", corrupted)).rejects.toThrow();
  });

  it("rejects structurally invalid envelopes with CorruptVaultError", async () => {
    await expect(
      openEnvelope("pw", { v: 1 } as never),
    ).rejects.toBeInstanceOf(CorruptVaultError);
  });

  it("encryptWithKey/decryptWithKey round-trips with an imported raw key", async () => {
    const env = await sealEnvelope("pw", "seed");
    // Re-derive the same key by opening the envelope's KDF parameters.
    const { deriveKey } = await import("../src/core/crypto");
    const key = await deriveKey("pw", fromB64(env.kdf.saltB64), env.kdf.iterations);
    const raw = await exportKeyRaw(key);
    const key2 = await importKeyRaw(raw);
    const { ivB64, ctB64 } = await encryptWithKey(key2, "round two");
    await expect(decryptWithKey(key2, ivB64, ctB64)).resolves.toBe("round two");
  });
});
