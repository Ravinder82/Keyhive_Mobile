import type {
  ModelInfo,
  ProviderId,
  SanitizedError,
  UsageMetadata,
} from "../shared/types";
import { categoryFromStatus, errorFromCategory } from "./sanitize";
import { runStandardPipeline } from "./types";
import type { CostFn, ProviderAdapter, SendTestArgs } from "./types";

interface AdapterConfig {
  id: ProviderId;
  displayName: string;
  models: ModelInfo[];
  defaultModel: string;
  /** Strict prefix/shape check; null disables format validation. */
  keyPattern: RegExp | null;
  endpoint(model: string): string;
  headers(apiKey: string): Record<string, string>;
  requestBody(model: string, prompt: string, maxTokens: number): unknown;
  normalizeUsage(body: unknown): UsageMetadata | undefined;
  /** Optional function to fetch live models from the provider using the API key. */
  fetchModels?(apiKey: string): Promise<ModelInfo[]>;
}

export function makeAdapter(cfg: AdapterConfig): ProviderAdapter {
  const adapter: ProviderAdapter = {
    id: cfg.id,
    displayName: cfg.displayName,
    getModels: () => cfg.models,
    defaultModel: () => cfg.defaultModel,
    validateConfiguration(apiKey: string): SanitizedError | null {
      if (!apiKey || apiKey.trim().length === 0) {
        return { category: "bad_request", message: "API key is required.", retryable: false };
      }
      if (cfg.keyPattern && !cfg.keyPattern.test(apiKey.trim())) {
        return {
          category: "bad_request",
          message: `This does not look like a ${cfg.displayName} API key.`,
          retryable: false,
        };
      }
      return null;
    },
    endpoint: cfg.endpoint,
    headers: cfg.headers,
    requestBody: cfg.requestBody,
    normalizeUsage: cfg.normalizeUsage,
    normalizeError(status: number): SanitizedError {
      return errorFromCategory(categoryFromStatus(status), status);
    },
    sendTestRequest(args: SendTestArgs, costFn?: CostFn) {
      return runStandardPipeline(adapter, args, costFn);
    },
    testConnection(args: SendTestArgs, costFn?: CostFn) {
      return adapter.sendTestRequest(args, costFn);
    },
    fetchModels: cfg.fetchModels
      ? (apiKey: string) => cfg.fetchModels!(apiKey)
      : async () => {
          // Fallback: return static models if no live fetch is implemented.
          return cfg.models;
        },
  };
  return adapter;
}
