import type { LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { ApiError } from "@/lib/http";

export type ChatProvider = "openai" | "anthropic" | "xai";

type SupportedModel = {
  provider: ChatProvider;
  id: string;
  label: string;
  stream: true;
  default?: boolean;
};

const SUPPORTED_MODELS: SupportedModel[] = [
  {
    provider: "openai",
    id: "gpt-5.2",
    label: "GPT-5.2",
    stream: true,
    default: true
  },
  {
    provider: "openai",
    id: "gpt-5.2-mini",
    label: "GPT-5.2 Mini",
    stream: true
  },
  {
    provider: "anthropic",
    id: "claude-sonnet-4.5",
    label: "Claude Sonnet 4.5",
    stream: true,
    default: true
  },
  {
    provider: "xai",
    id: "grok-4-latest",
    label: "Grok 4 Latest",
    stream: true,
    default: true
  }
];

export function getProviderReadiness() {
  const gatewayConfigured = isGatewayConfigured();
  return {
    openai: gatewayConfigured,
    anthropic: gatewayConfigured,
    xai: gatewayConfigured
  };
}

export function listSupportedModels() {
  return SUPPORTED_MODELS.map(({ provider, id, label, stream, default: isDefault }) => ({
    provider,
    model: id,
    label,
    capabilities: {
      stream
    },
    default: Boolean(isDefault)
  }));
}

export function resolveModelSelection(input: { provider?: string; model?: string }) {
  const requestedProvider = input.provider?.trim().toLowerCase();
  const requestedModel = input.model?.trim();

  if (requestedProvider && !isProvider(requestedProvider)) {
    throw new ApiError(400, "unsupported_provider", `Unsupported provider: ${input.provider}`);
  }

  if (requestedProvider && requestedModel) {
    const exact = SUPPORTED_MODELS.find(
      (entry) => entry.provider === requestedProvider && entry.id === requestedModel
    );
    if (!exact) {
      throw new ApiError(
        400,
        "unsupported_model",
        `Model "${requestedModel}" is not supported for provider "${requestedProvider}".`,
        requestedProvider
      );
    }

    ensureProviderConfigured(exact.provider);
    return exact;
  }

  if (requestedModel) {
    const matched = SUPPORTED_MODELS.find((entry) => entry.id === requestedModel);
    if (!matched) {
      throw new ApiError(400, "unsupported_model", `Unsupported model: ${requestedModel}`);
    }

    ensureProviderConfigured(matched.provider);
    return matched;
  }

  if (requestedProvider) {
    const providerDefault = SUPPORTED_MODELS.find(
      (entry) => entry.provider === requestedProvider && entry.default
    );
    if (!providerDefault) {
      throw new ApiError(
        400,
        "unsupported_provider",
        `No default model configured for provider "${requestedProvider}".`,
        requestedProvider
      );
    }

    ensureProviderConfigured(providerDefault.provider);
    return providerDefault;
  }

  const defaultModel = SUPPORTED_MODELS.find(
    (entry) => entry.provider === "openai" && entry.default
  );
  if (!defaultModel) {
    throw new ApiError(500, "default_model_missing", "No default chat model is configured.");
  }

  ensureProviderConfigured(defaultModel.provider);
  return defaultModel;
}

export function createLanguageModel(provider: ChatProvider, modelId: string): LanguageModel {
  ensureProviderConfigured(provider);
  return createOpenAICompatibleProvider()(modelId);
}

function ensureProviderConfigured(provider: ChatProvider) {
  if (!isGatewayConfigured()) {
    throw new ApiError(
      503,
      "provider_not_configured",
      `${provider} provider gateway is not configured on the server.`,
      provider
    );
  }
}

function isProvider(value: string): value is ChatProvider {
  return value === "openai" || value === "anthropic" || value === "xai";
}

function isGatewayConfigured() {
  return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_BASE_URL);
}

function createOpenAICompatibleProvider() {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL;

  if (!apiKey || !baseURL) {
    return createOpenAI({ apiKey: "missing-gateway-config" });
  }

  return createOpenAI({
    apiKey,
    baseURL
  });
}
