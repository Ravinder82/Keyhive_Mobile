/**
 * Provider registry. The rest of the app resolves adapters only through this
 * module — no provider-specific logic outside src/providers.
 */

import type { ProviderCatalogEntry, ProviderId } from "../shared/types";
import { anthropicAdapter } from "./anthropic";
import { geminiAdapter } from "./gemini";
import { openaiAdapter } from "./openai";
import { openRouterAdapter } from "./openrouter";
import type { ProviderAdapter } from "./types";

const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
  openrouter: openRouterAdapter,
};

export function getAdapter(provider: ProviderId): ProviderAdapter {
  return ADAPTERS[provider];
}

export function listProviderCatalog(): ProviderCatalogEntry[] {
  return (Object.keys(ADAPTERS) as ProviderId[]).map((id) => ({
    id,
    displayName: ADAPTERS[id].displayName,
    docsUrl:
      id === "openai"
        ? "https://platform.openai.com/api-keys"
        : id === "anthropic"
          ? "https://console.anthropic.com/settings/keys"
          : id === "gemini"
            ? "https://aistudio.google.com/app/apikey"
            : "https://openrouter.ai/keys",
    apiKeyHint:
      id === "openai"
        ? "Starts with sk-"
        : id === "anthropic"
          ? "Starts with sk-ant-"
          : id === "gemini"
            ? "Starts with AIza"
            : "Starts with sk-or-",
    defaultModel: ADAPTERS[id].defaultModel(),
    models: ADAPTERS[id].getModels(),
  }));
}
