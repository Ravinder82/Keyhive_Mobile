import { useEffect, useRef, useState } from "react";
import type { CredentialMeta, ProviderCatalogEntry, ProviderId } from "../shared/types";
import { sendToBackground } from "../shared/types";

/** CredentialList: context chips (selection) + add-credential form. */
export function CredentialList(props: {
  credentials: CredentialMeta[];
  selectedId: string | null;
  onSelect(id: string | null): void;
  onChanged(): void;
}) {
  const [showForm, setShowForm] = useState(props.credentials.length === 0);
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[]>([]);
  const [provider, setProvider] = useState<ProviderId>("openai");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const armedTimer = useRef<number | null>(null);

  useEffect(() => {
    sendToBackground<ProviderCatalogEntry[]>({ type: "catalog/list" }).then((res) => {
      if (res.ok) {
        setCatalog(res.data);
        setProvider(res.data[0]?.id ?? "openai");
      }
    });
  }, []);

  // Clear the armed-delete timer if the list unmounts mid-arm.
  useEffect(
    () => () => {
      if (armedTimer.current !== null) window.clearTimeout(armedTimer.current);
    },
    [],
  );

  async function add() {
    setBusy(true);
    setError(null);
    const res = await sendToBackground<CredentialMeta>({
      type: "cred/add",
      label,
      provider,
      apiKey,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setLabel("");
    setApiKey("");
    setShowForm(false);
    props.onChanged();
  }

  /** Two-step confirm: first click arms, second click (within 4s) deletes.
   * window.confirm is unusable in a popup — Chrome dismisses the popup on blur. */
  function remove(id: string, name: string) {
    if (armedDelete !== id) {
      setArmedDelete(id);
      if (armedTimer.current !== null) window.clearTimeout(armedTimer.current);
      armedTimer.current = window.setTimeout(() => setArmedDelete(null), 4000);
      return;
    }
    if (armedTimer.current !== null) window.clearTimeout(armedTimer.current);
    setArmedDelete(null);
    void (async () => {
      const res = await sendToBackground({ type: "cred/delete", id });
      if (res.ok) {
        if (props.selectedId === id) props.onSelect(null);
        props.onChanged();
      } else if (!res.ok) {
        setError(res.message);
      }
      void name;
    })();
  }

  return (
    <section aria-label="Credentials">
      <div className="cred-chips">
        <button
          type="button"
          className={`cred-chip ${props.selectedId === null ? "active" : ""}`}
          onClick={() => props.onSelect(null)}
          aria-pressed={props.selectedId === null}
        >
          <span className="dot" aria-hidden="true" />
          <span className="name">All credentials</span>
        </button>
        {props.credentials.map((c) => (
          <span key={c.id} className="cred-chip-wrap">
            <button
              type="button"
              className={`cred-chip ${props.selectedId === c.id ? "active" : ""}`}
              aria-pressed={props.selectedId === c.id}
              title={c.label}
              onClick={() => props.onSelect(c.id)}
            >
              <span
                className={`dot ${c.lastTestStatus === "success" ? "ok" : c.lastTestStatus === "failure" ? "fail" : ""}`}
                aria-hidden="true"
              />
              <span className="name">{c.label}</span>
              <span className="hint">{c.maskedHint}</span>
            </button>
            <button
              type="button"
              className={`chip-remove ${armedDelete === c.id ? "armed" : ""}`}
              aria-label={
                armedDelete === c.id
                  ? `Click again to permanently delete ${c.label}`
                  : `Delete credential ${c.label}`
              }
              title="Delete credential"
              onClick={() => remove(c.id, c.label)}
            >
              {armedDelete === c.id ? (
                <span aria-live="assertive">Sure?</span>
              ) : (
                "×"
              )}
            </button>
          </span>
        ))}
        <button
          type="button"
          className="cred-chip"
          onClick={() => setShowForm((v) => !v)}
          aria-expanded={showForm}
        >
          <span className="name">+ Add key</span>
        </button>
      </div>

      {showForm && (
        <form
          className="card form-grid"
          style={{ marginTop: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <div className="form-row">
            <label>
              <span className="sr-only">Provider</span>
              <select value={provider} onChange={(e) => setProvider(e.target.value as ProviderId)}>
                {catalog.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Label</span>
              <input
                placeholder="Label (e.g. Work — GPT-4o mini)"
                value={label}
                maxLength={100}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
          </div>
          <div className="key-input-wrap">
            <input
              type={reveal ? "text" : "password"}
              placeholder={`${catalog.find((c) => c.id === provider)?.apiKeyHint ?? "API key"} — paste your key`}
              value={apiKey}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <button
              type="button"
              className="reveal-btn"
              onClick={() => setReveal((v) => !v)}
            >
              {reveal ? "hide" : "show"}
            </button>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <p className="form-hint">
            The key is encrypted with your master password before it touches storage. It is never
            logged and is only ever sent to the provider you selected, over HTTPS, when you run a
            test.
          </p>
          <div className="form-row">
            <button type="submit" disabled={busy || !label.trim() || !apiKey.trim()}>
              {busy ? "Saving…" : "Save to vault"}
            </button>
            <button type="button" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/** Compact summary of the currently-selected credential context. */
export function CredentialSummary({ credential }: { credential: CredentialMeta }) {
  return (
    <p className="chart-summary" style={{ margin: 0 }}>
      Viewing analytics for <strong>{credential.label}</strong> ({credential.provider},{" "}
      <code>{credential.maskedHint}</code>). Switch back to “All credentials” for global totals.
    </p>
  );
}
