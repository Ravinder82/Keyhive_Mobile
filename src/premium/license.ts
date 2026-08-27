/**
 * Dodo Payments license client, behind a swappable interface so the provider
 * can change without touching the rest of the app (DECISIONS/monetization.md).
 *
 * Endpoints (Dodo-style, mirrors Lemon Squeezy semantics):
 *   POST {base}/licenses/activate  { license_key, instance_name } -> activate device
 *   POST {base}/licenses/validate  { license_key, instance_id }   -> lazy revalidation
 *   POST {base}/licenses/deactivate{ license_key, instance_id }   -> free the seat
 *
 * Reference Policy: verify exact paths/payloads against current Dodo docs
 * before shipping (TASK_TRACKING PR-02). Unit tests mock the endpoint.
 */

import type { EntitlementRecord } from "./entitlements";
import { LICENSE_API_BASE, VALIDATE_TIMEOUT_MS } from "./config";

export type LicenseFailureReason =
  | "invalid"
  | "expired"
  | "disabled"
  | "activation_limit"
  | "network";

export class LicenseError extends Error {
  constructor(public readonly reason: LicenseFailureReason, message: string) {
    super(message);
    this.name = "LicenseError";
  }
}

export interface LicenseClient {
  activate(licenseKey: string, instanceName: string): Promise<EntitlementRecord>;
  validate(licenseKey: string, instanceId: string): Promise<EntitlementRecord>;
  deactivate(licenseKey: string, instanceId: string): Promise<void>;
}

interface ApiLicenseResponse {
  status?: string; // "active" | "inactive" | "expired" | "disabled"...
  instance_id?: string;
  error?: string;
}

async function post(path: string, body: unknown): Promise<ApiLicenseResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VALIDATE_TIMEOUT_MS);
  try {
    const res = await fetch(`${LICENSE_API_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as ApiLicenseResponse;
    if (!res.ok) {
      const msg = typeof data?.error === "string" ? data.error : "";
      if (res.status === 402 || /activation.?limit/i.test(msg)) {
        throw new LicenseError("activation_limit", "This license has no activations left.");
      }
      if (/expire/i.test(msg) || data?.status === "expired") {
        throw new LicenseError("expired", "This license has expired.");
      }
      if (/disabl/i.test(msg) || data?.status === "disabled") {
        throw new LicenseError("disabled", "This license has been disabled.");
      }
      throw new LicenseError("invalid", "That license key was not recognized.");
    }
    return data;
  } catch (err) {
    if (err instanceof LicenseError) throw err;
    // Network flake / timeout: callers keep the current entitlement state.
    throw new LicenseError("network", "Couldn't reach the license service.");
  } finally {
    clearTimeout(timer);
  }
}

function entitlementFrom(
  licenseKey: string,
  data: ApiLicenseResponse,
  previous?: EntitlementRecord,
): EntitlementRecord {
  if (data.status !== "active") {
    // Expired/disabled keys downgrade to free — features revert, data stays.
    return { tier: "free", status: "inactive" };
  }
  return {
    tier: "pro",
    status: "active",
    licenseKey,
    instanceId: data.instance_id ?? previous?.instanceId,
    lastValidatedAt: Date.now(),
  };
}

export const dodoLicenseClient: LicenseClient = {
  async activate(licenseKey, instanceName) {
    const data = await post("/licenses/activate", {
      license_key: licenseKey,
      instance_name: instanceName,
    });
    return entitlementFrom(licenseKey, data);
  },

  async validate(licenseKey, instanceId) {
    const data = await post("/licenses/validate", {
      license_key: licenseKey,
      instance_id: instanceId,
    });
    return entitlementFrom(licenseKey, data);
  },

  async deactivate(licenseKey, instanceId) {
    await post("/licenses/deactivate", {
      license_key: licenseKey,
      instance_id: instanceId,
    });
  },
};
