import { ApiError } from "../../../lib/api-error";
import { getProviderCreds, routeModel } from "../../../lib/utils";
import type { ChatCompletionPayload } from "./types";

export function ensureChatCompletionModel(payload: ChatCompletionPayload): string {
  if (!payload?.model) {
    throw new ApiError({
      status: 400,
      message: "model is required",
      type: "invalid_request_error",
      code: "missing_model",
    });
  }

  return payload.model;
}

export function resolveChatCompletionRequest(payload: ChatCompletionPayload): {
  model: string;
  provider: string;
  url: string;
  key: string;
} {
  const model = ensureChatCompletionModel(payload);
  const provider = routeModel(model);
  const credentials = getProviderCreds(provider);

  if (!credentials.url || !credentials.key) {
    throw new ApiError({
      status: 503,
      message: `Provider credentials for '${provider}' are not configured`,
      type: "service_unavailable",
      code: "provider_credentials_missing",
      details: { provider },
      logLevel: "warn",
    });
  }

  return {
    model,
    provider,
    url: credentials.url,
    key: credentials.key,
  };
}
