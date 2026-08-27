/**
 * Shared domain types for AI Keychain.
 * These types are the single source of truth across UI, background,
 * providers, analytics, cost and insights layers.
 */

// ---------------------------------------------------------------- providers

export type ProviderId = "openai" | "anthropic" | "gemini" | "openrouter";

export const PROVIDER_IDS: readonly ProviderId[] = [
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
] as const;

export function isProviderId(v: unknown): v is ProviderId {
  return typeof v === "string" && (PROVIDER_IDS as readonly string[]).includes(v);
}

export interface ModelInfo {
  id: string;
  label: string;
}

/** Static, curated catalog used for pickers. Adapters may still accept other ids. */
export interface ProviderCatalogEntry {
  id: ProviderId;
  displayName: string;
  docsUrl: string;
  apiKeyHint: string;
  defaultModel: string;
  models: ModelInfo[];
}

// ---------------------------------------------------------------- credentials

export interface CredentialMeta {
  id: string;
  label: string;
  provider: ProviderId;
  /** Non-secret display hint, e.g. "sk-…9f2a". Never contains the full key. */
  maskedHint: string;
  createdAt: number;
  lastTestedAt?: number;
  lastTestStatus?: "success" | "failure";
}

/** Only ever exists inside the encrypted vault payload. */
export interface CredentialRecord extends CredentialMeta {
  apiKey: string;
}

export function maskApiKey(provider: ProviderId, apiKey: string): string {
  const prefixes: Record<ProviderId, string> = {
    openai: "sk-",
    anthropic: "sk-ant-",
    gemini: "AIza",
    openrouter: "sk-or-",
  };
  const prefix = apiKey.startsWith(prefixes[provider]) ? prefixes[provider] : "";
  const tail = apiKey.slice(-4);
  return `${prefix || apiKey.slice(0, Math.min(3, apiKey.length))}…${tail}`;
}

// ---------------------------------------------------------------- vault

export interface VaultEnvelope {
  v: 1;
  kdf: { alg: "PBKDF2-SHA256"; iterations: number; saltB64: string };
  aead: "AES-256-GCM";
  ivB64: string;
  ctB64: string;
  createdAt: number;
  updatedAt: number;
}

/** Decrypted vault payload shape. Never persisted unencrypted. */
export interface VaultPayload {
  credentials: CredentialRecord[];
}

export interface VaultStatus {
  exists: boolean;
  unlocked: boolean;
  autoLockAt: number | null;
}

export interface ExtensionSettings {
  /** Minutes of inactivity before auto-lock. 0 disables auto-lock. */
  autoLockMinutes: number;
}

export const DEFAULT_SETTINGS: ExtensionSettings = { autoLockMinutes: 30 };

// ---------------------------------------------------------------- testing / errors

export type ErrorCategory =
  | "auth_invalid"
  | "rate_limited"
  | "quota_exceeded"
  | "bad_request"
  | "not_found"
  | "timeout"
  | "network_error"
  | "server_error"
  | "malformed_response"
  | "unknown";

export interface UsageMetadata {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface CostEstimate {
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  currency: "USD";
  pricingVersion: number;
}

export interface SanitizedError {
  category: ErrorCategory;
  /** Static human-readable text. Never includes provider response bodies. */
  message: string;
  httpStatus?: number;
  retryable: boolean;
}

export interface TestRequestSpec {
  credentialId: string;
  model: string;
  prompt?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface TestOutcome {
  ok: boolean;
  provider: ProviderId;
  model?: string;
  latencyMs: number;
  usage?: UsageMetadata;
  cost?: CostEstimate;
  error?: SanitizedError;
  testedAt: number;
}

// ---------------------------------------------------------------- analytics

export interface UsageEvent {
  eventId: string;
  schemaVersion: 1;
  timestamp: number;
  provider: ProviderId;
  model?: string;
  /** Local non-secret reference into the vault. */
  credentialId: string;
  status: "success" | "failure";
  errorCategory?: ErrorCategory;
  latencyMs: number;
  httpStatus?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** Present only when pricing was known at request time. */
  estimatedCostUsd?: number;
  costAvailable: boolean;
  /** False when the provider returned no usage metadata at all. */
  usageReported: boolean;
  pricingVersion?: number;
  testKind: "manual-test";
}

export type RangeKey = "24h" | "7d" | "30d" | "all";

export const RANGE_KEYS: readonly RangeKey[] = ["24h", "7d", "30d", "all"] as const;

export function rangeMillis(range: RangeKey): number | null {
  switch (range) {
    case "24h":
      return 24 * 60 * 60 * 1000;
    case "7d":
      return 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return 30 * 24 * 60 * 60 * 1000;
    case "all":
      return null;
  }
}

export function isRangeKey(v: unknown): v is RangeKey {
  return typeof v === "string" && (RANGE_KEYS as readonly string[]).includes(v);
}

export interface Summary {
  requests: number;
  successes: number;
  failures: number;
  /** null when there is no traffic yet */
  successRate: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  activeProviders: number;
  activeModels: number;
}

export interface SeriesPoint {
  /** Bucket start (epoch ms). */
  t: number;
  requests: number;
  failures: number;
  costUsd: number | null;
  latencyMs: number | null;
}

export interface BreakdownEntry {
  key: string;
  requests: number;
  share: number;
  costUsd: number | null;
}

export interface RecentActivityItem {
  eventId: string;
  timestamp: number;
  provider: ProviderId;
  model?: string;
  credentialId: string;
  credentialLabel?: string;
  status: "success" | "failure";
  latencyMs: number;
  errorCategory?: ErrorCategory;
  estimatedCostUsd?: number;
}

export interface GlobalDashboardData {
  range: RangeKey;
  hasAnyDataEver: boolean;
  summary: Summary;
  previousSummary: Summary | null;
  /** One shared time series; each point carries requests, failures, cost and latency. */
  series: SeriesPoint[];
  providerBreakdown: BreakdownEntry[];
  modelBreakdown: BreakdownEntry[];
  recentActivity: RecentActivityItem[];
  credentialsWithoutPricing: string[];
}

export interface CredentialDashboardData {
  credential: CredentialMeta;
  range: RangeKey;
  summary: Summary;
  previousSummary: Summary | null;
  series: SeriesPoint[];
  modelBreakdown: BreakdownEntry[];
  recentFailures: RecentActivityItem[];
  lastTest?: { at: number; ok: boolean };
}

export interface DashboardSnapshot {
  premium: { tier: "free" | "pro" };
  credentials: CredentialMeta[];
  selectedCredentialId: string | null;
  range: RangeKey;
  global: GlobalDashboardData;
  credential: CredentialDashboardData | null;
  insights: Insight[];
  settings: ExtensionSettings;
}

// ---------------------------------------------------------------- insights

export type InsightLayer = "need_to_know" | "needs_attention" | "watch" | "healthy";

export const LAYER_ORDER: Record<InsightLayer, number> = {
  need_to_know: 0,
  needs_attention: 1,
  watch: 2,
  healthy: 3,
};

export interface InsightMetric {
  label: string;
  value: string;
  compare?: string;
}

export interface InsightScope {
  provider?: ProviderId;
  credentialId?: string;
  model?: string;
}

export interface Insight {
  /** Stable across recomputation for identical conditions (dedupe key). */
  id: string;
  layer: InsightLayer;
  title: string;
  /** Deterministic explanation of why this fired. */
  detail: string;
  metrics: InsightMetric[];
  windowLabel: string;
  /** 1..5 */
  severity: number;
  /** 0..1 */
  confidence: number;
  /** Relative magnitude of the signal (e.g. 0.34 = +34%). */
  magnitude: number;
  /** 0..1 freshness weight of the underlying signal. */
  recency: number;
  score: number;
  scope: InsightScope;
  generatedAt: number;
}

// ---------------------------------------------------------------- messaging

export type BgRequest =
  | { type: "vault/status" }
  | { type: "vault/create"; password: string }
  | { type: "vault/unlock"; password: string }
  | { type: "vault/lock" }
  | { type: "vault/changePassword"; current: string; next: string }
  | { type: "dashboard/snapshot"; range: RangeKey; credentialId: string | null }
  | { type: "cred/list" }
  | { type: "cred/add"; label: string; provider: ProviderId; apiKey: string }
  | { type: "cred/delete"; id: string }
  | { type: "catalog/list" }
  | { type: "test/run"; spec: TestRequestSpec }
  | { type: "settings/get" }
  | { type: "premium/status" }
  | { type: "premium/activate"; licenseKey: string }
  | { type: "premium/deactivate" }
  | { type: "settings/set"; patch: Partial<ExtensionSettings> }
  | { type: "data/clearAnalytics" }
  | { type: "data/deleteAll" };

export type BgResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string };

export type ErrorCode =
  | "entitlement_required"
  | "locked"
  | "wrong_password"
  | "weak_password"
  | "vault_exists"
  | "no_vault"
  | "not_found"
  | "duplicate_label"
  | "invalid_input"
  | "provider_error"
  | "internal"
  | "corrupt_vault";

export async function sendToBackground<T>(req: BgRequest): Promise<BgResponse<T>> {
  try {
    const res = await chrome.runtime.sendMessage(req);
    return res as BgResponse<T>;
  } catch (err) {
    return {
      ok: false,
      code: "internal",
      message: err instanceof Error ? err.message : "Extension communication failed.",
    };
  }
}

export function formatUsd(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  if (n === 0) return "$0.00";
  return `$${n.toFixed(6).replace(/0+$/, "")}`;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: n >= 10000 ? "compact" : "standard" }).format(n);
}

export function formatDuration(ms: number): string {
  if (ms < 1) return `${ms.toFixed(1)}ms`;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
