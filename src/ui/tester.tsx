import { useEffect, useMemo, useState } from "react";
import type {
  CredentialMeta,
  ModelInfo,
  ProviderCatalogEntry,
  TestOutcome,
} from "../shared/types";
import { formatDuration, formatNumber, formatUsd, sendToBackground } from "../shared/types";

const DEFAULT_PROMPT = "Reply with the single word OK.";

/** ApiTester: run one sanitized test request against a saved credential. */
export function ApiTester(props: {
  credentials: CredentialMeta[];
  selectedId: string | null;
  onTested(): void;
}) {
  const cred = useMemo(
    () => props.credentials.find((c) => c.id === (props.selectedId ?? props.credentials[0]?.id)),
    [props.credentials, props.selectedId],
  );
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[]>([]);
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    sendToBackground<ProviderCatalogEntry[]>({ type: "catalog/list" }).then((res) => {
      if (res.ok) setCatalog(res.data);
    });
  }, []);

  const entry = catalog.find((c) => c.id === cred?.provider);
  useEffect(() => {
    setModel(entry?.defaultModel ?? "");
    setOutcome(null);
    setError(null);
  }, [entry?.id]);

  async function run() {
    if (!cred) return;
    setBusy(true);
    setError(null);
    const res = await sendToBackground<TestOutcome>({
      type: "test/run",
      spec: { credentialId: cred.id, model: model || entry?.defaultModel || "", prompt },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setOutcome(res.data);
    props.onTested();
  }

  async function refreshModels() {
    if (!cred) return;
    setRefreshingModels(true);
    setError(null);
    try {
      const res = await sendToBackground<ModelInfo[]>({
        type: "cred/fetchModels",
        id: cred.id,
      });
      if (res.ok) {
        // The credential's cachedModels are now updated; tell parent to refresh the dashboard.
        props.onTested();
      } else {
        setError(res.message || "Failed to refresh models.");
      }
    } catch (err) {
      setError("Failed to refresh models.");
    } finally {
      setRefreshingModels(false);
    }
  }

  if (!cred) {
    return (
      <section className="card" aria-label="API tester">
        <h3>Test API</h3>
        <p className="chart-summary">Add a credential first — the tester runs against a saved key.</p>
      </section>
    );
  }

  // Use cached models if available, otherwise fall back to the static catalog.
  const availableModels = cred.cachedModels && cred.cachedModels.length > 0
    ? cred.cachedModels
    : (entry?.models ?? []);

  return (
    <section className="card" aria-label="API tester">
      <h3>Test API — {cred.label}</h3>
      <div className="form-grid">
        <div className="form-row">
          <label>
            <span className="sr-only">Model</span>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              {model && !availableModels.some((m) => m.id === model) && (
                <option value={model}>{model}</option>
              )}
            </select>
          </label>
          <button type="button" onClick={() => void run()} disabled={busy}>
            {busy ? (
              <>
                <span className="spinner" aria-hidden="true" /> Sending…
              </>
            ) : (
              "Send test request"
            )}
          </button>
          <button
            type="button"
            onClick={refreshModels}
            disabled={refreshingModels || !cred}
            title="Fetch the latest model list from the provider using your API key"
          >
            {refreshingModels ? "Refreshing…" : "Refresh models"}
          </button>
        </div>
        <input
          type="text"
          placeholder={`Prompt (optional, default: “${DEFAULT_PROMPT}”)`}
          maxLength={500}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          aria-label="Custom prompt for the test request"
        />
      </div>

      <p className="form-hint">
        Requests go directly from this extension to the provider over HTTPS. Prompts are not
        stored; only anonymous usage metadata (status, latency, tokens) is kept locally.
      </p>

      {error && <p className="form-error" role="alert">{error}</p>}

      {outcome && (
        <div className="test-result" role="status">
          <div className="test-status-line">
            <span className={`status-pill ${outcome.ok ? "ok" : "bad"}`}>
              {outcome.ok ? "Success" : "Failed"}
            </span>
            <span>{new Date(outcome.testedAt).toLocaleTimeString()}</span>
            <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 11 }}>
              {formatDuration(outcome.latencyMs)}
            </span>
          </div>
          {outcome.ok ? (
            <>
              <KV k="Model" v={outcome.model ?? "—"} />
              <KV
                k="Tokens"
                v={
                  outcome.usage?.totalTokens !== undefined
                    ? formatNumber(outcome.usage.totalTokens)
                    : outcome.usage
                      ? "reported partially"
                      : "not reported"
                }
              />
              <KV
                k="Estimated cost"
                v={
                  outcome.cost
                    ? `${formatUsd(outcome.cost.totalCostUsd)} (estimate)`
                    : "Cost unavailable — no known pricing for this model"
                }
              />
            </>
          ) : (
            <>
              <KV k="Reason" v={outcome.error?.message ?? "Unknown failure"} />
              <KV
                k="Category"
                v={`${outcome.error?.category ?? "unknown"}${outcome.error?.httpStatus !== undefined ? ` · HTTP ${outcome.error.httpStatus}` : ""}`}
              />
              <p className="chart-summary" style={{ marginTop: 6 }}>
                Provider response details are never shown or logged, so no sensitive data can leak
                through errors.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="kv-row">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}