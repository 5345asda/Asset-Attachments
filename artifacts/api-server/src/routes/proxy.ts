import { Router, type Request, type Response } from "express";
import { ApiError } from "../lib/api-error";
import { getRequestLogger } from "../lib/request-context";
import { getProviderCreds, routeModel } from "../lib/utils";
import {
  getChatCompletionForwarder,
  type ChatCompletionPayload,
} from "./providers/chat-completions";

const router = Router();

const MODELS = [
  { id: "claude-opus-4-6", owned_by: "anthropic" },
  { id: "claude-opus-4-5", owned_by: "anthropic" },
  { id: "claude-opus-4-1", owned_by: "anthropic" },
  { id: "claude-sonnet-4-6", owned_by: "anthropic" },
  { id: "claude-sonnet-4-5", owned_by: "anthropic" },
  { id: "claude-haiku-4-5", owned_by: "anthropic" },
  { id: "gpt-5.2", owned_by: "openai" },
  { id: "gpt-5.1", owned_by: "openai" },
  { id: "gpt-5", owned_by: "openai" },
  { id: "gpt-5-mini", owned_by: "openai" },
  { id: "gpt-5-nano", owned_by: "openai" },
  { id: "gpt-4.1", owned_by: "openai" },
  { id: "gpt-4.1-mini", owned_by: "openai" },
  { id: "gpt-4.1-nano", owned_by: "openai" },
  { id: "gpt-4o", owned_by: "openai" },
  { id: "gpt-4o-mini", owned_by: "openai" },
  { id: "o4-mini", owned_by: "openai" },
  { id: "o3", owned_by: "openai" },
  { id: "o3-mini", owned_by: "openai" },
  { id: "gemini-2.5-pro", owned_by: "google" },
  { id: "gemini-2.5-flash", owned_by: "google" },
];

function ensureModel(payload: ChatCompletionPayload): string {
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

function ensureProviderCredentials(provider: string): { url: string; key: string } {
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

  return credentials;
}

router.get("/models", (_req: Request, res: Response) => {
  res.json({
    object: "list",
    data: MODELS.map((model) => ({ ...model, object: "model", created: 1700000000 })),
  });
});

router.post("/chat/completions", async (req: Request, res: Response) => {
  const payload = req.body as ChatCompletionPayload;
  const model = ensureModel(payload);
  const provider = routeModel(model);
  const requestLogger = getRequestLogger(req);
  const { url, key } = ensureProviderCredentials(provider);
  const forwarder = getChatCompletionForwarder(provider);

  requestLogger.info(
    {
      model,
      provider,
      stream: !!payload.stream,
      tools: Array.isArray(payload.tools) ? payload.tools.length : 0,
      temperature: payload.temperature,
      top_p: payload.top_p,
      max_tokens: payload.max_tokens,
      messages: Array.isArray(payload.messages) ? payload.messages.length : 0,
    },
    "Proxy request",
  );

  if (forwarder) {
    await forwarder({
      payload,
      provider,
      requestLogger,
      res,
      url,
      key,
    });
    return;
  }

  throw new ApiError({
    status: 400,
    message: `Unknown provider for model: ${model}`,
    type: "invalid_request_error",
    code: "unknown_provider",
    details: { model },
  });
});

export default router;
