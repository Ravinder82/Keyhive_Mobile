/**
 * R2-04: property-based router fuzzing (fast-check).
 *
 * Invariants under arbitrary input:
 *  - Malformed payloads NEVER produce code "internal" — only typed domain codes.
 *  - Valid payloads produce ok:true; the data contracts hold.
 */
import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { call } from "./router-helpers";
import { mockStorage } from "./setup";
import { RANGE_KEYS } from "../src/shared/types";
await import("../src/background/main");

beforeEach?.(() => undefined);

async function unlockedVault(): Promise<void> {
  mockStorage.local.clear();
  mockStorage.session.clear();
  vi.unstubAllGlobals();
  const res = await call({ type: "vault/create", password: "property-pass-1" });
  if (!res.ok) throw new Error("vault create failed: " + res.message);
}

describe("R2-04 property-based router fuzzing", () => {
  it(
    "dashboard/snapshot: arbitrary range values are typed invalid_input; real ranges succeed",
    async () => {
      await unlockedVault();
      const nonRange = fc
        .string({ maxLength: 40 })
        .filter((s) => !(RANGE_KEYS as readonly string[]).includes(s));
      await fc.assert(
        fc.asyncProperty(nonRange, async (range) => {
          const res = (await call({ type: "dashboard/snapshot", range, credentialId: null })) as {
            ok: boolean;
            code?: string;
          };
          return res.ok === false && res.code === "invalid_input";
        }),
        { numRuns: 500 },
      );
      for (const range of RANGE_KEYS) {
        const res = await call({ type: "dashboard/snapshot", range, credentialId: null });
        // Free tier: 24h/7d succeed; 30d/all are gated behind Pro.
        if (range === "24h" || range === "7d") expect(res.ok).toBe(true);
        else expect(res).toMatchObject({ ok: false, code: "entitlement_required" });
      }
    },
    120_000,
  );

  it(
    "test/run: arbitrary spec shapes yield invalid_input or not_found — never internal",
    async () => {
      await unlockedVault();
      const specArb = fc.oneof(
        fc.constant(undefined),
        fc.jsonValue(),
        fc.record({
          credentialId: fc.oneof(fc.string({ maxLength: 30 }), fc.integer(), fc.constant(null)),
          model: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
          prompt: fc.option(fc.oneof(fc.string({ maxLength: 600 }), fc.integer()), { nil: undefined }),
          maxTokens: fc.option(fc.double({ noNaN: true }), { nil: undefined }),
          timeoutMs: fc.option(fc.integer(), { nil: undefined }),
        }),
      );
      await fc.assert(
        fc.asyncProperty(specArb, async (spec) => {
          const res = (await call({ type: "test/run", spec })) as { ok: boolean; code?: string };
          if (res.ok) return false; // no credential exists, ok:true is impossible
          return res.code === "invalid_input" || res.code === "not_found";
        }),
        { numRuns: 300 },
      );
    },
    120_000,
  );

  it(
    "settings/set: arbitrary patches are whitelisted — ok only for valid autoLockMinutes",
    async () => {
      await unlockedVault();
      const valueArb = fc.oneof(
        fc.integer(),
        fc.double({ noNaN: true }),
        fc.string({ maxLength: 20 }),
        fc.constant(null),
        fc.boolean(),
      );
      const patchArb = fc.oneof(
        fc.record({ autoLockMinutes: valueArb }),
        fc.dictionary(fc.string({ minLength: 1, maxLength: 12 }), valueArb, {
          minKeys: 1,
          maxKeys: 3,
        }),
      );
      await fc.assert(
        fc.asyncProperty(patchArb, async (patch) => {
          const res = (await call({ type: "settings/set", patch })) as {
            ok: boolean;
            code?: string;
            data?: { autoLockMinutes?: number };
          };
          if (res.ok) {
            const keys = Object.keys(patch);
            const v = (patch as { autoLockMinutes?: unknown }).autoLockMinutes;
            const valid =
              keys.length === 1 &&
              keys[0] === "autoLockMinutes" &&
              typeof v === "number" &&
              Number.isFinite(v) &&
              v >= 0 &&
              v <= 1440;
            if (!valid) return false;
            if (res.data?.autoLockMinutes !== Math.round(v as number)) return false;
            return true;
          }
          return res.code === "invalid_input";
        }),
        { numRuns: 500 },
      );
    },
    120_000,
  );

  it(
    "cred/add: arbitrary labels/keys give typed outcomes and never corrupt the vault",
    async () => {
      await unlockedVault();
      let expectedCount = 0;
      const keyArb = fc.oneof(
        fc.constant("sk-propkey1234567890abcd"),
        fc.constant("sk-propkey1234567890abce"),
        fc.string({ maxLength: 50 }),
      );
      const labelArb = fc.oneof(
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.constant(""),
        fc.string({ minLength: 1, maxLength: 40 }),
      );
      await fc.assert(
        fc.asyncProperty(fc.tuple(labelArb, keyArb), async ([label, apiKey]) => {
          const before = expectedCount;
          const res = (await call({
            type: "cred/add",
            label,
            provider: "openai",
            apiKey,
          })) as { ok: boolean; code?: string };
          if (res.ok) {
            expectedCount += 1;
          } else {
            // entitlement_required = free cap reached (valid request, gated).
            if (!["invalid_input", "duplicate_label", "entitlement_required"].includes(res.code ?? "")) {
              return false;
            }
            if (res.code === "entitlement_required") {
              const listNow = (await call({ type: "cred/list" })) as { data: unknown[] };
              if (listNow.data.length < 2) return false; // cap only at >= 2
            }
          }
          const list = (await call({ type: "cred/list" })) as { ok: boolean; data: unknown[] };
          if (!list.ok) return false;
          if (list.data.length !== expectedCount) return false;
          return true;
        }),
        { numRuns: 200 },
      );
    },
    120_000,
  );
});
