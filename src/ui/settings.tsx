import { useEffect, useRef, useState } from "react";
import type { ExtensionSettings } from "../shared/types";
import { sendToBackground } from "../shared/types";
import { ProSettingsSection } from "./premium";

/** Settings: auto-lock, master password change, local data controls. */
export function SettingsPanel(props: {
  settings: ExtensionSettings;
  onClose(): void;
  onSaved(msg: string): void;
  onVaultChanged(): void;
}) {
  const [autoLock, setAutoLock] = useState(String(props.settings.autoLockMinutes));
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [armed, setArmed] = useState<"analytics" | "all" | null>(null);
  const armedTimer = useRef<number | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);

  /** Two-step confirm for destructive actions (window.confirm is unusable in a popup). */
  function arm(key: "analytics" | "all"): boolean {
    if (armed !== key) {
      setArmed(key);
      if (armedTimer.current !== null) window.clearTimeout(armedTimer.current);
      armedTimer.current = window.setTimeout(() => setArmed(null), 4000);
      return false;
    }
    if (armedTimer.current !== null) window.clearTimeout(armedTimer.current);
    setArmed(null);
    return true;
  }

  // Clear any armed-confirm timer if the modal unmounts mid-arm.
  useEffect(
    () => () => {
      if (armedTimer.current !== null) window.clearTimeout(armedTimer.current);
    },
    [],
  );

  // Focus trap: focus the first control, cycle Tab within the dialog, close
  // on Escape, and restore focus to the opener on unmount.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const modal = modalRef.current;
    const focusables = () =>
      modal
        ? (Array.from(
            modal.querySelectorAll<HTMLElement>(
              'button, input, select, [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => !el.hasAttribute("disabled")) as HTMLElement[])
        : [];
    focusables()[0]?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        props.onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !modal?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      opener?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveAutoLock() {
    // Number inputs yield "" for garbage input in real browsers — never let an
    // empty value silently disable auto-lock (it would parse as 0).
    if (autoLock.trim() === "") {
      setErr("Enter a number between 0 and 1440 minutes (0 disables auto-lock).");
      return;
    }
    const n = Number(autoLock);
    if (!Number.isFinite(n) || n < 0 || n > 1440) {
      setErr("Auto-lock must be a number between 0 and 1440 minutes.");
      return;
    }
    const res = await sendToBackground<ExtensionSettings>({
      type: "settings/set",
      patch: { autoLockMinutes: Math.round(n) },
    });
    if (res.ok) props.onSaved("Auto-lock updated.");
    else setErr(res.message);
  }

  async function changePassword() {
    if (next !== confirm) {
      setErr("New passwords do not match.");
      return;
    }
    setErr(null);
    const res = await sendToBackground({ type: "vault/changePassword", current: cur, next });
    if (!res.ok) {
      setErr(
        res.code === "wrong_password"
          ? "Current password is incorrect."
          : res.message,
      );
      return;
    }
    setCur("");
    setNext("");
    setConfirm("");
    props.onSaved("Master password changed. All data re-encrypted.");
    props.onVaultChanged();
  }

  async function clearAnalytics() {
    if (!arm("analytics")) return;
    const res = await sendToBackground({ type: "data/clearAnalytics" });
    if (res.ok) props.onSaved("Analytics history cleared.");
  }

  async function deleteAll() {
    if (!arm("all")) return;
    const res = await sendToBackground({ type: "data/deleteAll" });
    if (res.ok) window.location.reload();
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Settings" ref={modalRef}>
        <div className="modal-head">
          <h2>Settings</h2>
          <button type="button" className="icon-btn" onClick={props.onClose} aria-label="Close settings">
            ✕
          </button>
        </div>

        {err && <p className="form-error" role="alert">{err}</p>}

        <ProSettingsSection entitlement={null} onChanged={props.onVaultChanged} />

        <div className="settings-row">
          <label htmlFor="autolock">Auto-lock after inactivity</label>
          <input
            id="autolock"
            type="number"
            min={0}
            max={1440}
            value={autoLock}
            onChange={(e) => setAutoLock(e.target.value)}
          />
          <button type="button" onClick={() => void saveAutoLock()}>
            Save
          </button>
        </div>
        <p className="form-hint">0 disables auto-lock. The key lives in memory only.</p>

        <hr className="divider" />

        <h3 style={{ fontSize: 12 }}>Change master password</h3>
        <input
          type="password"
          placeholder="Current password"
          value={cur}
          autoComplete="current-password"
          onChange={(e) => setCur(e.target.value)}
        />
        <input
          type="password"
          placeholder="New password (min 8 characters)"
          value={next}
          autoComplete="new-password"
          onChange={(e) => setNext(e.target.value)}
        />
        <input
          type="password"
          placeholder="Repeat new password"
          value={confirm}
          autoComplete="new-password"
          onChange={(e) => setConfirm(e.target.value)}
        />
        <button type="button" disabled={!cur || !next} onClick={() => void changePassword()}>
          Re-encrypt vault with new password
        </button>

        <hr className="divider" />

        <div className="danger-zone">
          <h3 style={{ fontSize: 12 }}>Local data</h3>
          <p className="form-hint">
            Everything is stored locally. Nothing has ever left this browser except direct provider
            requests.
          </p>
          <div className="form-row">
            <button
              type="button"
              className={armed === "analytics" ? "armed" : ""}
              onClick={() => void clearAnalytics()}
            >
              {armed === "analytics" ? (
                <span aria-live="assertive">Click again to confirm</span>
              ) : (
                "Clear analytics"
              )}
            </button>
            <button
              type="button"
              className={armed === "all" ? "armed" : ""}
              aria-label="Delete all data — click twice to confirm. This cannot be undone."
              onClick={() => void deleteAll()}
            >
              {armed === "all" ? (
                <span aria-live="assertive">Click again — irreversible</span>
              ) : (
                "Delete all data"
              )}
            </button>
          </div>
        </div>

        <hr className="divider" />
        <p className="form-hint">
          There is no password recovery by design. If you forget the master password the only option
          is deleting all data above.
        </p>
      </div>
    </div>
  );
}
