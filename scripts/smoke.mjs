/**
 * End-to-end smoke test of the built extension over the Chrome DevTools
 * Protocol — drives the REAL popup page and REAL service worker:
 *   vault create → credential add → real provider test → analytics → insights
 */
/**
 * Live end-to-end smoke test (see TESTING.md §2).
 *
 * Usage:
 *   1. Build: npm run build
 *   2. Launch Chromium/Chrome-for-Testing with the extension and a CDP port:
 *        "<chromium>" --user-data-dir=/tmp/ak-test \
 *          --load-extension="$PWD/dist" --remote-debugging-port=9222 about:blank
 *      (Branded stable Chrome ignores --load-extension; use Load unpacked or CfT.)
 *   3. Run: npm run smoke
 * Env: SMOKE_DEBUG_URL (default http://127.0.0.1:9222), SMOKE_EXT_ID (default:
 * unpacked id derived from the dist/ path hash).
 */
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DEBUG_HOST = process.env.SMOKE_DEBUG_URL ?? "http://127.0.0.1:9222";
const here = dirname(fileURLToPath(import.meta.url));
const distPath = resolve(here, "../dist");
const EXT_ID =
  process.env.SMOKE_EXT_ID ??
  createHash("sha256")
    .update(distPath)
    .digest("hex")
    .slice(0, 32)
    .split("")
    .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
    .join("");

async function json(url) {
  const res = await fetch(url);
  return res.json();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    ws.onopen = () =>
      resolve({
        send(method, params = {}) {
          return new Promise((res2, rej2) => {
            const id = nextId++;
            pending.set(id, { res: res2, rej: rej2 });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close: () => ws.close(),
      });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    };
    ws.onerror = reject;
  });
}

async function evaluate(cdp, expression) {
  const out = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (out.exceptionDetails) {
    throw new Error("Page threw: " + JSON.stringify(out.exceptionDetails.exception?.description ?? out.exceptionDetails.text));
  }
  return out.result.value;
}

const results = [];
function check(name, cond, detail = "") {
  results.push({ name, pass: Boolean(cond), detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

// ---------------------------------------------------------------- main
const targets = await json(`${DEBUG_HOST}/json/list`);
let popup = targets.find((t) => t.type === "page" && t.url.includes(EXT_ID) && t.url.includes("popup.html"));
if (!popup) popup = targets.find((t) => t.type === "page");
if (!popup) {
  console.error("FATAL: no page target. Targets:", targets.map((t) => `${t.type}:${t.url}`));
  process.exit(2);
}
const cdp = await connect(popup.webSocketDebuggerUrl);

// Navigate to the extension popup (also proves the extension serves its UI).
await cdp.send("Page.enable");
await cdp.send("Page.navigate", { url: `chrome-extension://${EXT_ID}/popup.html` });
await new Promise((r) => setTimeout(r, 2500));

const send = (msg) =>
  evaluate(cdp, `chrome.runtime.sendMessage(${JSON.stringify(msg)}).then(r => r)`);

// 1. Extension context sanity
const manifest = await evaluate(cdp, `({v: chrome.runtime.getManifest().version, id: chrome.runtime.id, mv: chrome.runtime.getManifest().manifest_version})`);
check("extension context alive (MV3)", manifest.mv === 3 && manifest.id === EXT_ID, JSON.stringify(manifest));

// 2. Vault status before creation
let r = await send({ type: "vault/status" });
check("vault/status responds ok", r.ok === true, JSON.stringify(r.data));
check("no vault exists initially", r.data?.exists === false);

// 3. Reject weak password
r = await send({ type: "vault/create", password: "short" });
check("weak password rejected", r.ok === false && /8 characters/.test(r.message), r.message);

// 4. Create vault
r = await send({ type: "vault/create", password: "smoke-test-master-1" });
check("vault created", r.ok === true, JSON.stringify(r));

// 5. Wrong password rejected on relock path later; first verify unlocked status
r = await send({ type: "vault/status" });
check("vault exists + unlocked after create", r.data?.exists === true && r.data?.unlocked === true);

// 6. Add a credential (format-valid fake OpenAI key)
r = await send({ type: "cred/add", label: "Smoke OpenAI", provider: "openai", apiKey: "sk-smoke1234567890abcdef1234" });
check("credential added with masked hint", r.ok === true && r.data?.maskedHint?.startsWith("sk-…"), JSON.stringify(r.data?.maskedHint));
const credId = r.data?.id;

// 7. Duplicate label rejected
r = await send({ type: "cred/add", label: "Smoke OpenAI", provider: "openai", apiKey: "sk-duplicate1234567890abcd" });
check("duplicate label rejected", r.ok === false && r.code === "duplicate_label", r.message);

// 8. Wrong-format key rejected without network
r = await send({ type: "cred/add", label: "Bad key", provider: "gemini", apiKey: "sk-not-gemini" });
check("wrong-format key rejected pre-network", r.ok === false && r.code === "invalid_input", r.message);

// 9. Lock, verify locked, unlock with wrong then right password
await send({ type: "vault/lock" });
r = await send({ type: "cred/list" });
check("locked vault refuses cred/list", r.ok === false && r.code === "locked", r.code);
r = await send({ type: "vault/unlock", password: "wrong-password-1" });
check("wrong master password rejected", r.ok === false && r.code === "wrong_password", r.code);
r = await send({ type: "vault/unlock", password: "smoke-test-master-1" });
check("correct master password unlocks", r.ok === true);

// 10. Run a REAL test request against OpenAI with the fake key (expect sanitized 401)
r = await send({ type: "test/run", spec: { credentialId: credId, model: "gpt-4o-mini" } });
const outcome = r.data;
check("test pipeline returns sanitized failure", outcome?.ok === false && outcome?.error?.category === "auth_invalid",
  JSON.stringify({ cat: outcome?.error?.category, http: outcome?.error?.httpStatus }));
check("sanitized error leaks no key material", !JSON.stringify(outcome).includes("sk-smoke1234567890abcdef1234"));

// 11. Analytics recorded exactly one event
r = await send({ type: "dashboard/snapshot", range: "24h", credentialId: null });
const snap = r.data;
check("snapshot ok", r.ok === true);
check("exactly one usage event recorded", snap.global.summary.requests === 1, `requests=${snap.global.summary.requests}`);
check("failure counted", snap.global.summary.failures === 1);
check("recent activity shows auth_invalid", snap.global.recentActivity[0]?.errorCategory === "auth_invalid");
check("credential marked lastTest failure", snap.credentials[0]?.lastTestStatus === "failure");

// 12. Insights generated deterministically from that event
const authInsight = snap.insights.find((i) => i.id.startsWith("attention-auth"));
check("needs-attention insight fired for auth failures", Boolean(authInsight), authInsight?.title ?? "none");
check("insights carry explanation + metrics", snap.insights.every((i) => i.detail.length > 10 && i.metrics.length > 0));

// 13. Credential-scoped dashboard
r = await send({ type: "dashboard/snapshot", range: "24h", credentialId: credId });
check("credential dashboard scopes to selection", r.data?.credential?.credential.id === credId && r.data.credential.summary.requests === 1);

// 14. Settings round-trip
r = await send({ type: "settings/set", patch: { autoLockMinutes: 15 } });
check("settings persisted", r.data?.autoLockMinutes === 15);

// 15. Storage contains no plaintext key material
const storageProbe = await evaluate(cdp,
  `(async () => {
    const local = await chrome.storage.local.get(null);
    const s = JSON.stringify(local);
    return { hasSecret: s.includes("sk-smoke1234567890abcdef1234"), hasEnvelope: !!local["vault.envelope.v1"], keys: Object.keys(local) };
  })()`);
check("no plaintext API key in storage", storageProbe.hasSecret === false, JSON.stringify(storageProbe.keys));
check("vault stored as encrypted envelope", storageProbe.hasEnvelope === true);

// 16. Cleanup: delete all data
r = await send({ type: "data/deleteAll" });
check("delete-all works", r.ok === true);
r = await send({ type: "vault/status" });
check("vault gone after delete-all", r.data?.exists === false);

cdp.close();
const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
