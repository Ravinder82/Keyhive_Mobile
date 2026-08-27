/**
 * Premium UI: header badge, upgrade modal (honest feature table + buy link),
 * license activation, and the Settings Pro section. No nags — upsell appears
 * only at feature limits or when the user opens it.
 */

import { useEffect, useState } from "react";
import type { EntitlementRecord } from "../premium/entitlements";
import { FREE_MAX_CREDENTIALS, PRO_FEATURES } from "../premium/entitlements";
import { BUY_PRO_URL } from "../premium/config";
import { sendToBackground } from "../shared/types";

/** Header badge: subtle "Pro" mark when entitled, quiet upgrade chip when free. */
export function ProBadge({ pro, onOpen }: { pro: boolean; onOpen(): void }) {
  return (
    <button
      type="button"
      className={pro ? "pro-badge pro" : "pro-badge"}
      onClick={onOpen}
      aria-label={pro ? "AI Keychain Pro is active" : "Upgrade to AI Keychain Pro"}
      title={pro ? "AI Keychain Pro" : "Upgrade to Pro"}
    >
      {pro ? "PRO" : "✦ Pro"}
    </button>
  );
}

/** Upgrade modal: what Pro includes, buy link, license activation. */
export function UpgradeModal(props: {
  onClose(): void;
  onActivated(): void;
}) {
  const [licenseKey, setLicenseKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function activate() {
    setBusy(true);
    setErr(null);
    const res = await sendToBackground<EntitlementRecord>({
      type: "premium/activate",
      licenseKey,
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    props.onActivated();
    props.onClose();
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Upgrade to Pro">
        <div className="modal-head">
          <h2>AI Keychain Pro</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={props.onClose}>
            ✕
          </button>
        </div>

        <p className="form-hint" style={{ margin: 0 }}>
          One-time purchase — $19. All version 1.x updates included. Your data stays local either
          way.
        </p>

        <ul className="pro-features">
          {PRO_FEATURES.map((f) => (
            <li key={f}>
              <span aria-hidden="true" className="pro-check">✓</span> {f}
            </li>
          ))}
        </ul>

        <a className="buy-btn" href={BUY_PRO_URL} target="_blank" rel="noreferrer">
          Buy Pro — $19 (secure checkout)
        </a>

        <hr className="divider" />

        <label htmlFor="license-input" style={{ fontSize: 12, fontWeight: 600 }}>
          Already bought? Activate your license
        </label>
        <div className="form-row">
          <input
            id="license-input"
            type="text"
            placeholder="Paste your license key"
            value={licenseKey}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setLicenseKey(e.target.value)}
          />
          <button type="button" disabled={busy || !licenseKey.trim()} onClick={() => void activate()}>
            {busy ? "Activating…" : "Activate"}
          </button>
        </div>
        {err && <p className="form-error" role="alert">{err}</p>}
        <p className="form-hint">
          Activation connects once to the license service to verify your key — nothing else is ever
          sent. Clearing the extension's data removes the license from this device; re-paste the key
          to restore it.
        </p>
      </div>
    </div>
  );
}

/** Settings → Pro section: current tier + activation/management. */
export function ProSettingsSection(props: {
  entitlement: EntitlementRecord | null;
  onChanged(): void;
}) {
  const [licenseKey, setLicenseKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fetched, setFetched] = useState<EntitlementRecord | null>(null);
  const ent = props.entitlement ?? fetched;

  useEffect(() => {
    if (props.entitlement) return;
    sendToBackground<EntitlementRecord>({ type: "premium/status" }).then((res) => {
      if (res.ok) setFetched(res.data);
    });
  }, [props.entitlement]);

  const pro = ent?.tier === "pro" && ent?.status === "active";

  async function activate() {
    setBusy(true);
    setErr(null);
    const res = await sendToBackground<EntitlementRecord>({
      type: "premium/activate",
      licenseKey,
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    setLicenseKey("");
    props.onChanged();
  }

  async function deactivate() {
    setBusy(true);
    const res = await sendToBackground({ type: "premium/deactivate" });
    setBusy(false);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    props.onChanged();
  }

  return (
    <section aria-label="AI Keychain Pro" className="card form-grid">
      <h3>AI Keychain Pro</h3>
      {pro ? (
        <>
          <p className="form-hint" style={{ margin: 0 }}>
            <strong>Pro is active</strong> on this device. Thank you for supporting the project.
          </p>
          <button type="button" disabled={busy} onClick={() => void deactivate()}>
            {busy ? "Deactivating…" : "Deactivate license on this device"}
          </button>
        </>
      ) : (
        <>
          <p className="form-hint" style={{ margin: 0 }}>
            Free tier: {FREE_MAX_CREDENTIALS} credentials, 24h/7d analytics, core insights.{" "}
            <a href={BUY_PRO_URL} target="_blank" rel="noreferrer">
              Upgrade to Pro — $19 once
            </a>
            .
          </p>
          <div className="form-row">
            <input
              type="text"
              placeholder="License key (restore or activate)"
              value={licenseKey}
              autoComplete="off"
              spellCheck={false}
              aria-label="License key"
              onChange={(e) => setLicenseKey(e.target.value)}
            />
            <button type="button" disabled={busy || !licenseKey.trim()} onClick={() => void activate()}>
              {busy ? "Activating…" : "Activate"}
            </button>
          </div>
        </>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
    </section>
  );
}
