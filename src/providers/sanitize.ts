/**
 * Error normalization/sanitization.
 *
 * Rule: provider response bodies are NEVER surfaced to the UI or stored in
 * analytics. Every failure maps to a fixed category + static human message.
 */

import type { ErrorCategory, SanitizedError } from "../shared/types";
import { TransportError } from "./http";

const MESSAGES: Record<ErrorCategory, string> = {
  auth_invalid: "Authentication failed — the API key was rejected.",
  rate_limited: "Rate limited by the provider — too many requests.",
  quota_exceeded: "Quota or billing limit reached on this account.",
  bad_request: "The provider rejected the request as invalid.",
  not_found: "Model or endpoint not found for this provider.",
  timeout: "The request timed out before the provider responded.",
  network_error: "Network error — the request may not have left your device.",
  server_error: "The provider reported a server-side problem.",
  malformed_response: "The provider returned an unexpected response shape.",
  unknown: "Request failed for an unrecognized reason.",
};

const RETRYABLE: Record<ErrorCategory, boolean> = {
  rate_limited: true,
  timeout: true,
  network_error: true,
  server_error: true,
  unknown: true,
  auth_invalid: false,
  quota_exceeded: false,
  bad_request: false,
  not_found: false,
  malformed_response: false,
};

export function sanitizedMessage(category: ErrorCategory): string {
  return MESSAGES[category];
}

export function errorFromCategory(category: ErrorCategory, httpStatus?: number): SanitizedError {
  return { category, message: MESSAGES[category], httpStatus, retryable: RETRYABLE[category] };
}

/** Maps an HTTP status code from a provider to a sanitized category. */
export function categoryFromStatus(status: number): ErrorCategory {
  if (status === 401 || status === 403) return "auth_invalid";
  if (status === 402) return "quota_exceeded";
  if (status === 404) return "not_found";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  if (status >= 400) return "bad_request";
  return "unknown";
}

export function errorFromStatus(status: number): SanitizedError {
  return errorFromCategory(categoryFromStatus(status), status);
}

export function errorFromTransport(err: unknown): SanitizedError {
  if (err instanceof TransportError) {
    return err.kind === "timeout" ? errorFromCategory("timeout") : errorFromCategory("network_error");
  }
  return errorFromCategory("unknown");
}
