/**
 * R1-11: UI interaction tests — real user flows through the App against a
 * scripted background: credential add, API tester, settings (validation,
 * visible toast, Escape, focus trap).
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const events: UsageEvent[] = Array.from({ length: 6 }, (_, i) => ({
  eventId: `e${i}`,
  schemaVersion: 1,
  timestamp: NOW - i * HOUR,
  provider: "openai",
  model: "gpt-4o-mini",
  credentialId: "c1",
  status: "success",
  latencyMs: 400,
  inputTokens: 100,
  outputTokens: 20,
  totalTokens: 120,
  costAvailable: true,
  usageReported: true,
  estimatedCostUsd: 0.00002,
  testKind: "manual-test" as const,
}));

function fixtureSnapshot() {
  return buildSnapshot(creds, events, { autoLockMinutes: 30 }, "7d", null);
}

const CATALOG = [
  {
    id: "openai",
    displayName: "OpenAI",
    docsUrl: "https://platform.openai.com/api-keys",
    apiKeyHint: "Starts with sk-",
    defaultModel: "gpt-4o-mini",
    models: [{ id: "gpt-4o-mini", label: "GPT-4o mini" }],
  },
];

function scriptBackground(handlers: Record<string, (req: never) => unknown>) {
  const calls: { type: string; req: unknown }[] = [];
  setSendMessageMock((req) => {
    const type = (req as { type: string }).type;
    calls.push({ type, req });
    const ok = (data: unknown) => ({ ok: true, data });
    if (handlers[type]) return ok(handlers[type](req as never));
    if (type === "vault/status") return ok({ exists: true, unlocked: true });
    if (type === "dashboard/snapshot") return ok(fixtureSnapshot());
    if (type === "catalog/list") return ok(CATALOG);
    if (type === "settings/get") return ok({ autoLockMinutes: 30 });
    return ok(null);
  });
  return calls;
}

describe("UI interactions", () => {
  it("add-credential flow sends cred/add and refreshes the dashboard", async () => {
    let added: unknown = null;
    const calls = scriptBackground({
      "cred/add": (req) => {
        added = req;
        return {
          id: "c2",
          label: (req as { label: string }).label,
          provider: "openai",
          maskedHint: "sk-…new",
          createdAt: NOW,
        };
      },
    });
    render(<App surface="popup" />);
    await screen.findByText("+ Add key"); // dashboard (snapshot) has rendered

    fireEvent.click(screen.getByText("+ Add key"));
    fireEvent.change(screen.getByPlaceholderText(/Label \(e\.g\./), { target: { value: "New key" } });
    fireEvent.change(screen.getByPlaceholderText(/paste your key/), {
      target: { value: "sk-ui-test-1234567890ab" },
    });
    fireEvent.click(screen.getByText("Save to vault"));

    await waitFor(() => expect(added).not.toBeNull());
    expect(added).toMatchObject({ type: "cred/add", label: "New key", provider: "openai" });
    // The dashboard refreshes after the mutation.
    await waitFor(() =>
      expect(calls.filter((c) => c.type === "dashboard/snapshot").length).toBeGreaterThanOrEqual(2),
    );
  }, 20_000);

  it("API tester sends test/run and renders the sanitized outcome", async () => {
    scriptBackground({
      "test/run": () => ({
        ok: true,
        provider: "openai",
        model: "gpt-4o-mini",
        latencyMs: 123,
        usage: { inputTokens: 9, outputTokens: 2, totalTokens: 11 },
        testedAt: NOW,
      }),
    });
    render(<App surface="popup" />);
    await screen.findByText(/Test API — OpenAI work/);

    fireEvent.click(screen.getByText("Send test request"));
    expect(await screen.findByText("Success")).toBeTruthy();
    expect(screen.getByText("123ms")).toBeTruthy();
    expect(screen.getByText(/estimate/)).toBeTruthy();
  }, 20_000);

  it("settings: invalid auto-lock shows a visible error; valid save shows a visible toast", async () => {
    let savedPatch: unknown = null;
    scriptBackground({
      "settings/set": (req) => {
        savedPatch = (req as { patch: unknown }).patch;
        return { autoLockMinutes: (savedPatch as { autoLockMinutes: number }).autoLockMinutes };
      },
    });
    render(<App surface="popup" />);
    await screen.findByText("+ Add key"); // dashboard has rendered
    fireEvent.click(screen.getByLabelText("Open settings"));

    const input = screen.getByLabelText(/Auto-lock after inactivity/);
    // Number inputs reject "abc" (value becomes ""); -5 is the invalid case
    // a real browser can actually produce.
    fireEvent.change(input, { target: { value: "-5" } });
    fireEvent.click(screen.getByText("Save"));
    expect(await screen.findByText(/between 0 and 1440/)).toBeTruthy();
    expect(savedPatch).toBeNull(); // rejected client-side, nothing sent

    // Empty input must not silently disable auto-lock (empty would parse as 0).
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByText("Save"));
    expect(await screen.findByText(/Enter a number between 0 and 1440/)).toBeTruthy();
    expect(savedPatch).toBeNull();

    fireEvent.change(input, { target: { value: "15" } });
    fireEvent.click(screen.getByText("Save"));
    const toast = await screen.findByText("Auto-lock updated.");
    expect(toast.closest(".toast")).toBeTruthy(); // visible toast container, not sr-only
    expect(savedPatch).toEqual({ autoLockMinutes: 15 });
  }, 20_000);

  it("credential delete uses two-step confirm — no native dialog", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    let deleted = false;
    const calls = scriptBackground({
      "cred/delete": () => {
        deleted = true;
        return { ok: true };
      },
    });
    render(<App surface="popup" />);
    await screen.findByRole("button", { name: "Delete credential OpenAI work" });

    fireEvent.click(screen.getByRole("button", { name: "Delete credential OpenAI work" }));
    // First click arms only — nothing deleted yet.
    expect(deleted).toBe(false);
    expect(screen.getByRole("button", { name: "Click again to permanently delete OpenAI work" })).toBeTruthy();

    // Second click within the window deletes.
    fireEvent.click(screen.getByRole("button", { name: "Click again to permanently delete OpenAI work" }));
    await waitFor(() => expect(deleted).toBe(true));
    expect(calls.filter((c) => c.type === "cred/delete").length).toBe(1);
    expect(confirmSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  }, 20_000);

  it("delete-all data requires the armed second click", async () => {
    let wiped = false;
    scriptBackground({
      "data/deleteAll": () => {
        wiped = true;
        return { ok: true };
      },
    });
    render(<App surface="popup" />);
    await screen.findByText("+ Add key");
    fireEvent.click(screen.getByLabelText("Open settings"));

    const wipeBtn = screen.getByLabelText(/Delete all data — click twice to confirm/);
    fireEvent.click(wipeBtn);
    expect(wiped).toBe(false);
    expect(screen.getByText("Click again — irreversible")).toBeTruthy();

    fireEvent.click(screen.getByText("Click again — irreversible"));
    await waitFor(() => expect(wiped).toBe(true));
  }, 20_000);

  it("boot failure shows a retryable error — never the unlock form", async () => {
    let healthy = false;
    setSendMessageMock((req) => {
      const type = (req as { type: string }).type;
      const ok = (d: unknown) => ({ ok: true, data: d });
      if (type === "vault/status") {
        return healthy ? ok({ exists: true, unlocked: true }) : { ok: false, code: "internal", message: "x" };
      }
      if (type === "dashboard/snapshot") return ok(fixtureSnapshot());
      if (type === "catalog/list") return ok(CATALOG);
      if (type === "settings/get") return ok({ autoLockMinutes: 30 });
      return ok(null);
    });
    render(<App surface="popup" />);
    expect(await screen.findByText("Couldn't reach the keychain")).toBeTruthy();
    expect(screen.queryByText(/Vault locked/)).toBeNull();
    expect(screen.queryByText("Create your keychain")).toBeNull();

    healthy = true;
    fireEvent.click(screen.getByText("Retry"));
    expect(await screen.findByText("+ Add key")).toBeTruthy();
  }, 20_000);

  it("expanded dashboard tab is Pro-gated for free users", async () => {
    scriptBackground({});
    render(<App surface="popup" />);
    await screen.findByText("+ Add key");
    fireEvent.click(screen.getByLabelText("Open expanded dashboard in a tab"));
    expect(await screen.findByRole("dialog", { name: "Upgrade to Pro" })).toBeTruthy();
    // No tab was opened: chrome.tabs.create is mocked as a no-op in setup, so
    // the assertion above (modal instead of navigation) is the contract.
  }, 20_000);

  it("settings modal: Escape closes and focus stays trapped inside the dialog", async () => {
    scriptBackground({});
    render(<App surface="popup" />);
    await screen.findByText("AI Keychain");
    const gear = screen.getByLabelText("Open settings");
    gear.focus(); // real browsers focus buttons on click; jsdom does not
    fireEvent.click(gear);

    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    // Initial focus lands inside the dialog.
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Shift+Tab from the first focusable wraps to the last (trapped).
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Focus returns to the opener.
    expect(document.activeElement).toBe(gear);
  }, 20_000);
});
