/**
 * Typed provider adapter interface (doc §19) plus the shared test pipeline.
 * Each adapter owns: model catalog, key format validation, request shape and
 * usage normalization. Error sanitization is centralized in sanitize.ts.
 */

import type {
  CostEstimate,
  ModelInfo,
  ProviderId,
  SanitizedError,
  TestOutcome,
  UsageMetadata,
} from "../shared/types";
import { errorFromTransport, sanitizedMessage } from "./sanitize";
import { fetchJson, readJsonBody } from "./http";

export interface SendTestArgs {
  apiKey: string;
  model: string;
  prompt: string;
  maxTokens: number;
  timeoutMs: number;
}

interface PipelineSpec {
  id: ProviderId;
  endpoint(model: string): string;
  headers(apiKey: string): Record<string, string>;
  requestBody(model: string, prompt: string, maxTokens: number): unknown;
}

export interface ProviderAdapter extends PipelineSpec {
  displayName: string;
  getModels(): ModelInfo[];
  defaultModel(): string;
  /** Returns null when the key plausibly matches the provider's format. */
  validateConfiguration(apiKey: string): SanitizedError | null;
  /** Fetch the latest model list from the provider using the given API key. */
  fetchModels(apiKey: string): Promise<ModelInfo[]>;
  /** Full round trip; resolves to a sanitized outcome (never throws). */
  sendTestRequest(args: SendTestArgs, costFn?: CostFn): Promise<TestOutcome>;
  testConnection(args: SendTestArgs, costFn?: CostFn): Promise<TestOutcome>;
  normalizeUsage(body: unknown): UsageMetadata | undefined;
  normalizeError(status: number): SanitizedError;
}

export type CostFn = (usage: UsageMetadata | undefined, model: string) => CostEstimate | undefined;

const DEFAULT_TIMEOUT_MS = 20_000;

/** Shared pipeline: transport → status check → usage extraction. */
export async function runStandardPipeline(
  spec: PipelineSpec & Pick<ProviderAdapter, "normalizeUsage" | "normalizeError">,
  args: SendTestArgs,
  costFn?: CostFn,
): Promise<TestOutcome> {
  const started = performance.now();
  const finish = () => Math.round(performance.now() - started);
  try {
    const res = await fetchJson(
      spec.endpoint(args.model),
      {
        method: "POST",
        headers: { "content-type": "application/json", ...spec.headers(args.apiKey) },
        body: JSON.stringify(spec.requestBody(args.model, args.prompt, args.maxTokens)),
      },
      args.timeoutMs > 0 ? args.timeoutMs : DEFAULT_TIMEOUT_MS,
    );
    const latencyMs = finish();
    if (!res.ok) {
      return fail(spec.id, args.model, latencyMs, spec.normalizeError(res.status));
    }
    const body = await readJsonBody(res);
    if (body === undefined || typeof body !== "object") {
      return fail(spec.id, args.model, latencyMs, {
        category: "malformed_response",
        message: sanitizedMessage("malformed_response"),
        retryable: false,
      });
    }
    const usage = spec.normalizeUsage(body);
    return {
      ok: true,
      provider: spec.id,
      model: args.model,
      latencyMs,
      usage,
      cost: costFn?.(usage, args.model),
      testedAt: Date.now(),
    };
  } catch (err) {
    // Transport-level failure (timeout / network). Never leaks err details.
    return fail(spec.id, args.model, finish(), errorFromTransport(err));
  }
}

function fail(
  provider: ProviderId,
  model: string | undefined,
  latencyMs: number,
  error: SanitizedError,
): TestOutcome {
  return { ok: false, provider, model, latencyMs, error, testedAt: Date.now() };
}
