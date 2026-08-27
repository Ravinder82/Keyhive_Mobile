import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DashboardSnapshot,
  ExtensionSettings,
  RangeKey,
  VaultStatus,
} from "../shared/types";
import { RANGE_KEYS, sendToBackground } from "../shared/types";
import { CostChart, LatencyTrend, UsageChart } from "./charts";
import {
  BreakdownList,
  EmptyState,
  InsightPanel,
  MetricCard,
  RecentActivity,
  deltaTone,
} from "./components";
import { CredentialList, CredentialSummary } from "./credentials";
import { ApiTester } from "./tester";
import { SettingsPanel } from "./settings";
import { ProBadge, UpgradeModal } from "./premium";
import { useLayoutMode } from "./useLayout";

type Phase = "boot" | "setup" | "locked" | "ready" | "error";

export default function App({ surface }: { surface: "popup" | "expanded" }) {
  const [phase, setPhase] = useState<Phase>("boot");
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [range, setRange] = useState<RangeKey>("7d");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settings, setSettings] = useState<ExtensionSettings>({ autoLockMinutes: 30 });
  const [showSettings, setShowSettings] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [toast, setToast] = useState<{ msg: string; error: boolean } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const toastTimer = useRef<number | null>(null);
  const refreshReq = useRef(0);
  const layout = useLayoutMode();

  const flash = useCallback((msg: string, error = false) => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast({ msg, error });
    toastTimer.current = window.setTimeout(() => setToast(null), error ? 6000 : 4000);
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast(null);
  }, []);

  const onOpenUpgrade = useCallback(() => setShowUpgrade(true), []);

  // Boot: determine vault state. Retry once on transient failure (service
  // worker cold-start). If status is still unknown, show a retryable error —
  // never the lock screen (no password was ever created) and never the create
  // screen (which must appear only when we KNOW no vault exists).
  const boot = useCallback(async (): Promise<boolean> => {
    let res = await sendToBackground<VaultStatus>({ type: "vault/status" });
    if (!res.ok) {
      await new Promise((r) => setTimeout(r, 400));
      res = await sendToBackground<VaultStatus>({ type: "vault/status" });
    }
    if (!res.ok) return false;
    setPhase(res.data.exists ? (res.data.unlocked ? "ready" : "locked") : "setup");
    return true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await boot();
      if (!cancelled && !ok) setPhase("error");
    })();
    return () => {
      cancelled = true;
    };
  }, [boot]);

  // Snapshot refresh whenever context changes or after mutations.
  const refresh = useCallback(async () => {
    const reqId = ++refreshReq.current;
    setRefreshing(true);
    // Watchdog: a wedged background must never leave the UI dimmed forever.
    const watchdog = window.setTimeout(() => {
      if (reqId === refreshReq.current) {
        setRefreshing(false);
        flash("Dashboard refresh timed out — showing last known data.", true);
      }
    }, 15_000);
    const res = await sendToBackground<DashboardSnapshot>({
      type: "dashboard/snapshot",
      range,
      credentialId: selectedId,
    });
    window.clearTimeout(watchdog);
    if (reqId !== refreshReq.current) return; // a newer request superseded this one
    setRefreshing(false);
    if (!res.ok) {
      if (res.code === "locked") {
        setPhase("locked");
      } else if (res.code === "entitlement_required") {
        setShowUpgrade(true);
      } else {
        flash("Couldn't refresh the dashboard — showing last known data.", true);
      }
      return; // keep last-good data rendered
    }
    setSnapshot(res.data);
    setSettings(res.data.settings);
    setPhase("ready");
  }, [range, selectedId, flash]);

  useEffect(() => {
    if (phase === "ready") void refresh();
  }, [phase, refresh]);

  if (phase === "boot") {
    return (
      <div className={`ak-root layout-${layout}`} aria-busy="true">
        <EmptyState icon="✦" title="Loading AI Keychain…" />
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className={`ak-root layout-${layout}`}>
        <EmptyState icon="⚠\uFE0E" title="Couldn't reach the keychain">
          <p>The keychain service didn't respond. Nothing is lost — retry, or reload the extension from chrome://extensions.</p>
          <button
            type="button"
            onClick={async () => {
              setPhase("boot");
              const ok = await boot();
              if (!ok) setPhase("error");
            }}
          >
            Retry
          </button>
        </EmptyState>
      </div>
    );
  }

  if (phase === "setup") {
    return (
      <div className={`ak-root layout-${layout}`}>
        <SetupScreen
          onCreated={async () => {
            await refresh();
            setPhase("ready");
          }}
        />
      </div>
    );
  }

  if (phase === "locked") {
    return (
      <div className={`ak-root layout-${layout}`}>
        <LockScreen
          onUnlocked={async () => {
            setSelectedId(null);
            await refresh();
          }}
        />
      </div>
    );
  }

  const g = snapshot?.global;
  const credData = snapshot?.credential ?? null;
  const selectedMeta = snapshot?.credentials.find((c) => c.id === selectedId) ?? null;

  return (
    <div className={`ak-root layout-${layout} ${refreshing ? "dash-updating" : ""}`}>
      <Header
        range={range}
        refreshing={refreshing}
        pro={snapshot?.premium.tier === "pro"}
        onRange={(r) => {
          const free = !snapshot || snapshot.premium.tier !== "pro";
          if (free && !(r === "24h" || r === "7d")) {
            setShowUpgrade(true);
            return;
          }
          setRange(r);
        }}
        onLock={async () => {
          await sendToBackground({ type: "vault/lock" });
          setSnapshot(null);
          setPhase("locked");
        }}
        onOpenExpanded={
          surface === "popup"
            ? () => {
                // Expanded dashboard is a Pro feature (PRO_FEATURES).
                if (snapshot?.premium.tier !== "pro") {
                  setShowUpgrade(true);
                  return;
                }
                chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
              }
            : undefined
        }
        onPro={onOpenUpgrade}
        onSettings={() => setShowSettings(true)}
      />

      {snapshot && (
        <>
          <CredentialList
            credentials={snapshot.credentials}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChanged={() => void refresh()}
          />

          {!snapshot.global.hasAnyDataEver && snapshot.credentials.length === 0 ? (
            <EmptyState icon="✦" title="Welcome to your local-first keychain">
              <p>
                Add your first API key above. Keys are encrypted locally with your master password
                and are only ever decrypted in memory to call the provider.
              </p>
              <p>After you test a key, usage, cost and insight analytics will appear here.</p>
            </EmptyState>
          ) : (
            <>
              {selectedMeta && <CredentialSummary credential={selectedMeta} />}

              <section aria-label="Key metrics" className="dash-body">
                <MetricGridForContext snapshot={snapshot} />
              </section>

              <div className="dash-cols dash-body">
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div className="charts-row">
                    <div className="card chart-block">
                      <h3>Usage over time</h3>
                      <UsageChart series={g?.series ?? []} range={range} />
                    </div>
                    <div className="card chart-block">
                      <h3>Estimated spend</h3>
                      <CostChart series={credData ? credData.series : (g?.series ?? [])} range={range} />
                    </div>
                  </div>

                  <div className="card">
                    <h3>Insights — what matters now</h3>
                    <InsightPanel insights={snapshot.insights} />
                  </div>

                  <div className="charts-row two">
                    <div className="card chart-block">
                      <h3>Latency trend</h3>
                      <LatencyTrend series={credData ? credData.series : (g?.series ?? [])} range={range} />
                    </div>
                    <div className="card">
                      <h3>Providers</h3>
                      <BreakdownList
                        entries={credData ? [] : (g?.providerBreakdown ?? [])}
                        emptyText="Provider breakdown appears in the global view."
                      />
                      <h3 style={{ marginTop: 10 }}>Models</h3>
                      <BreakdownList
                        entries={credData ? credData.modelBreakdown : (g?.modelBreakdown ?? [])}
                        emptyText="No model usage recorded yet."
                      />
                    </div>
                  </div>

                  <div className="card">
                    <h3>Recent activity</h3>
                    <RecentActivity items={credData ? credData.recentFailures : (g?.recentActivity ?? [])} />
                    {credData && (
                      <p className="chart-summary">Showing recent failures for this credential.</p>
                    )}
                  </div>
                </div>

                <ApiTester
                  credentials={snapshot.credentials}
                  selectedId={selectedId}
                  onTested={() => void refresh()}
                />
              </div>

              {g && g.credentialsWithoutPricing.length > 0 && (
                <p className="footer-note">
                  Cost unavailable for: {g.credentialsWithoutPricing.join(", ")} — no known pricing,
                  so no estimate is fabricated.
                </p>
              )}
            </>
          )}

          <p className="footer-note">
            ✓ Local-first · keys encrypted at rest · analytics contain no secrets
          </p>
        </>
      )}

      {showUpgrade && (
        <UpgradeModal
          onClose={() => setShowUpgrade(false)}
          onActivated={() => {
            flash("Pro activated — thank you!");
            void refresh();
          }}
        />
      )}
      {showSettings && snapshot && (
        <SettingsPanel
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSaved={(m) => flash(m)}
          onVaultChanged={() => void refresh()}
        />
      )}
      {toast && (
        <div className={`toast ${toast.error ? "error" : ""}`} role={toast.error ? "alert" : "status"}>
          <span>{toast.msg}</span>
          <button type="button" className="toast-dismiss" aria-label="Dismiss notification" onClick={dismissToast}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ header

function Header(props: {
  range: RangeKey;
  refreshing?: boolean;
  pro?: boolean;
  onPro(): void;
  onRange(r: RangeKey): void;
  onLock(): void;
  onOpenExpanded?(): void;
  onSettings(): void;
}) {
  return (
    <header className="ak-header">
      <span className="brand">
        <BrandMark />
        <span className="wordmark">AI Keychain</span>
      </span>
      {props.refreshing && (
        <>
          <span className="spinner" aria-hidden="true" />
          <span className="sr-only">Updating dashboard…</span>
        </>
      )}
      <span className="spacer" />
      <nav className="range-tabs" aria-label="Time range">
        {RANGE_KEYS.map((r) => (
          <button
            key={r}
            type="button"
            className={`range-tab ${props.range === r ? "active" : ""}`}
            aria-pressed={props.range === r}
            onClick={() => props.onRange(r)}
          >
            {r === "24h" ? "24h" : r === "7d" ? "7d" : r === "30d" ? "30d" : "All"}
          </button>
        ))}
      </nav>
      <ProBadge pro={Boolean(props.pro)} onOpen={props.onPro} />
      {props.onOpenExpanded && (
        <button type="button" className="icon-btn" onClick={props.onOpenExpanded} title="Open expanded dashboard" aria-label="Open expanded dashboard in a tab">
          <ExpandIcon />
        </button>
      )}
      <button type="button" className="icon-btn" onClick={props.onSettings} title="Settings" aria-label="Open settings">
        <GearIcon />
      </button>
      <button type="button" className="icon-btn" onClick={props.onLock} title="Lock vault" aria-label="Lock vault">
        <LockIcon />
      </button>
    </header>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 1.8 8.9 3.4a1 1 0 0 0 1 .5l1.8-.3 1 1.7-1.2 1.4a1 1 0 0 0-.2 1.1l.7 1.7-1.7 1-.9-1.5a1 1 0 0 0-1-.5l-1.8.3-1-1.7 1.2-1.4a1 1 0 0 0 .2-1.1L5.5 3.4l1.7-1 .9 1.5" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="10.2" r="1" fill="currentColor" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function BrandMark() {
  return (
    <svg className="ak-brand-mark" viewBox="0 0 32 32" role="img" aria-label="AI Keychain logo">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#16233c" stroke="#4f8ef7" strokeWidth="2" />
      <circle cx="13" cy="13" r="5" fill="none" stroke="#e6edf3" strokeWidth="2.4" />
      <path d="M17 17 L25 25 M22 22 L25 19 M19.5 19.5 L23 16" stroke="#e6edf3" strokeWidth="2.4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

// ------------------------------------------------------------- metric grid

function MetricGridForContext({ snapshot }: { snapshot: DashboardSnapshot }) {
  const s = snapshot.credential?.summary ?? snapshot.global.summary;
  const p = snapshot.credential?.previousSummary ?? snapshot.global.previousSummary;
  const pct = (cur: number | null, prev: number | null): string | null => {
    if (cur === null || prev === null || prev === 0) return null;
    const v = Math.round(((cur - prev) / prev) * 100);
    return v === 0 ? "±0%" : `${v > 0 ? "+" : ""}${v}%`;
  };

  const costDelta = pct(s.estimatedCostUsd, p?.estimatedCostUsd ?? null);
  const latencyDelta = pct(s.avgLatencyMs, p?.avgLatencyMs ?? null);

  return (
    <div className="metric-grid">
      <MetricCard label="Requests" value={s.requests.toLocaleString()} smallValue />
      <MetricCard
        label="Success rate"
        value={s.successRate !== null ? `${Math.round(s.successRate * 100)}%` : "—"}
        delta={
          s.successRate !== null && p?.successRate != null
            ? {
                text: pct(Math.round(s.successRate * 100), Math.round(p.successRate * 100)) ?? "",
                tone: s.successRate >= p.successRate ? "up-good" : "down-bad",
              }
            : undefined
        }
        smallValue
      />
      <MetricCard
        label="Est. spend"
        value={s.estimatedCostUsd !== null ? `$${s.estimatedCostUsd.toFixed(4)}` : "n/a"}
        delta={
          costDelta && s.estimatedCostUsd !== null && (p?.estimatedCostUsd ?? 0) > 0
            ? {
                text: costDelta,
                tone:
                  s.estimatedCostUsd >= (p?.estimatedCostUsd ?? 0)
                    ? deltaTone("up", false)
                    : deltaTone("down", false),
              }
            : undefined
        }
        smallValue
      />
      <MetricCard
        label="Tokens"
        value={s.totalTokens !== null ? compactNum(s.totalTokens) : "—"}
        smallValue
      />
      <MetricCard
        label="Avg latency"
        value={s.avgLatencyMs !== null ? `${s.avgLatencyMs}ms` : "—"}
        delta={
          latencyDelta && s.avgLatencyMs !== null && (p?.avgLatencyMs ?? 0) > 0
            ? {
                text: latencyDelta,
                tone:
                  s.avgLatencyMs <= (p?.avgLatencyMs ?? Infinity)
                    ? deltaTone("down", true)
                    : deltaTone("up", false),
              }
            : undefined
        }
        smallValue
      />
      <MetricCard
        label="Active"
        value={`${s.activeProviders}p · ${s.activeModels}m`}
        smallValue
      />
    </div>
  );
}

function compactNum(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

// ------------------------------------------------------------ auth screens

function SetupScreen({ onCreated }: { onCreated(): void }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== confirm) {
      setErr("Passwords do not match.");
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await sendToBackground({ type: "vault/create", password: pw });
    setBusy(false);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    onCreated();
  }

  return (
    <form className="card form-grid" onSubmit={submit} aria-label="Create vault">
      <h2 style={{ fontSize: 15 }}>Create your keychain</h2>
      <p className="form-hint">
        Your master password encrypts everything stored here using PBKDF2 + AES-GCM. It never
        leaves this browser and there is no recovery — choose it carefully.
      </p>
      <input
        type="password"
        placeholder="Master password (min 8 characters)"
        value={pw}
        autoFocus
        autoComplete="new-password"
        onChange={(e) => setPw(e.target.value)}
      />
      <input
        type="password"
        placeholder="Repeat master password"
        value={confirm}
        autoComplete="new-password"
        onChange={(e) => setConfirm(e.target.value)}
      />
      {err && <p className="form-error" role="alert">{err}</p>}
      <button type="submit" disabled={busy || pw.length < 8}>
        {busy ? "Encrypting…" : "Create encrypted vault"}
      </button>
    </form>
  );
}

function LockScreen({ onUnlocked }: { onUnlocked(): void }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await sendToBackground({ type: "vault/unlock", password: pw });
    setBusy(false);
    if (!res.ok) {
      setErr(res.code === "wrong_password" ? "Wrong master password." : res.message);
      return;
    }
    onUnlocked();
  }

  return (
    <form className="card form-grid" onSubmit={submit} aria-label="Unlock vault">
      <h2 style={{ fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
        <LockIcon /> Vault locked
      </h2>
      <p className="form-hint">Enter your master password to decrypt credentials in memory.</p>
      <input
        type="password"
        placeholder="Master password"
        value={pw}
        autoFocus
        autoComplete="current-password"
        onChange={(e) => setPw(e.target.value)}
      />
      {err && <p className="form-error" role="alert">{err}</p>}
      <button type="submit" disabled={busy || !pw}>
        {busy ? "Decrypting…" : "Unlock"}
      </button>
    </form>
  );
}
