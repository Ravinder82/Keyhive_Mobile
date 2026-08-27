/**
 * UI smoke tests: renders the real App against a mocked background message
 * layer and asserts the dashboard contract (metrics + insights + tester).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "../src/ui/App";
import { setSendMessageMock } from "./setup";
import { buildSnapshot } from "../src/background/main";
import type { CredentialMeta, UsageEvent } from "../src/shared/types";

const HOUR = 3_600_000;
const NOW = Date.now();

const creds: CredentialMeta[] = [
  {
    id: "c1",
    label: "OpenAI work",
    provider: "openai",
    maskedHint: "sk-…abcd",
    createdAt: NOW - 10 * 24 * HOUR,
  },
];

const events: UsageEvent[] = Array.from({ length: 12 }, (_, i) => ({
  eventId: `e${i}`,
  schemaVersion: 1,
  timestamp: NOW - i * HOUR,
  provider: "openai",
  model: "gpt-4o-mini",
  credentialId: "c1",
  status: i === 3 ? "failure" : "success",
  errorCategory: i === 3 ? "rate_limited" : undefined,
  latencyMs: 400 + i,
  inputTokens: 100,
  outputTokens: 20,
  totalTokens: 120,
  costAvailable: true,
  usageReported: true,
  estimatedCostUsd: 0.00002,
  testKind: "manual-test" as const,
}));

const snapshot = buildSnapshot(
  creds.map((c) => ({ ...c, lastTestedAt: NOW - HOUR, lastTestStatus: "success" as const })),
  events,
  { autoLockMinutes: 30 },
  "7d",
  null,
);

function mockBackground() {
  setSendMessageMock((req) => {
    const type = (req as { type: string }).type;
    const ok = (data: unknown) => ({ ok: true, data });
    if (type === "vault/status") return ok({ exists: true, unlocked: true });
    if (type === "dashboard/snapshot") return ok(snapshot);
    if (type === "catalog/list")
      return ok([
        {
          id: "openai",
          displayName: "OpenAI",
          docsUrl: "https://platform.openai.com/api-keys",
          apiKeyHint: "Starts with sk-",
          defaultModel: "gpt-4o-mini",
          models: [{ id: "gpt-4o-mini", label: "GPT-4o mini" }],
        },
      ]);
    if (type === "settings/get") return ok({ autoLockMinutes: 30 });
    return { ok: true, data: null };
  });
}

describe("App (popup surface)", () => {
  it("renders the dashboard with metrics, insights and tester when unlocked", async () => {
    mockBackground();
    render(<App surface="popup" />);
    expect(await screen.findByText("AI Keychain")).toBeTruthy();
    expect(await screen.findByText("Requests")).toBeTruthy();
    expect(screen.getByText("Est. spend")).toBeTruthy();
    expect(screen.getByText("Avg latency")).toBeTruthy();
    expect(screen.getByText("Insights — what matters now")).toBeTruthy();
    expect(screen.getByText("Test API — OpenAI work")).toBeTruthy();
    // Credential chips render with masked hints only.
    expect(screen.getAllByText("sk-…abcd").length).toBeGreaterThan(0);
  });

  it("shows the lock screen when the vault is locked", async () => {
    setSendMessageMock((req) => {
      const type = (req as { type: string }).type;
      if (type === "vault/status") return { ok: true, data: { exists: true, unlocked: false } };
      return { ok: true, data: null };
    });
    render(<App surface="popup" />);
    expect(await screen.findByText(/Vault locked/)).toBeTruthy();
  });

  it("shows onboarding when no vault exists", async () => {
    setSendMessageMock((req) => {
      const type = (req as { type: string }).type;
      if (type === "vault/status") return { ok: true, data: { exists: false, unlocked: false } };
      return { ok: true, data: null };
    });
    render(<App surface="popup" />);
    expect(await screen.findByText("Create your keychain")).toBeTruthy();
    expect(screen.getByText(/no recovery/i)).toBeTruthy();
  });
});
