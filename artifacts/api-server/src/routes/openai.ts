import { Router, type Request, type Response } from "express";
import { ApiError } from "../lib/api-error";
import { applyBillingOai } from "../lib/billing";
import {
  OPENAI_CHAT_COMPLETIONS_SUPPORTED_MODELS,
  OPENAI_IMAGE_GENERATION_SUPPORTED_MODELS,
  OPENAI_RESPONSES_SUPPORTED_MODELS,
  OPENAI_SUPPORTED_MODELS,
} from "../lib/openai-models";
import { getOpenAIProviderConfig } from "../lib/openai-provider";
import { getProxyStreamConfig, prepareProxyUpstream } from "../lib/proxy-stream";
import { getRequestLogger } from "../lib/request-context";
import { pipeReaderToResponse, readUpstreamArrayBufferWithKeepAlive } from "../lib/stream";
import { normalizeUpstreamStatus, sanitizeUpstreamError } from "../lib/upstream-error";

const router = Router();

export const openAIModelList = {
  data: OPENAI_SUPPORTED_MODELS.map((id) => ({
    id,
    object: "model",
    created: 1740000000,
    owned_by: "openai",
  })),
};

function buildTargetUrl(baseUrl: string, request: Request): string {
  const cleanBaseUrl = baseUrl.replace(/\/$/, "");
  const upstreamPath = request.path.replace(/^\/v1\//, "").replace(/^\//, "");
  const query = request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : "";
  return `${cleanBaseUrl}/${upstreamPath}${query}`;
}

function buildOpenAIHeaders(apiKey: string, request?: Request): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };

  if (request?.headers["content-type"]) {
    headers["Content-Type"] = request.headers["content-type"] as string;
  }

  const forwardHeaderNames = [
    "openai-organization",
    "openai-project",
    "openai-beta",
    "idempotency-key",
  ] as const;

  for (const headerName of forwardHeaderNames) {
    const value = request?.headers[headerName];
    if (typeof value === "string" && value.trim()) {
      headers[headerName] = value;
    }
  }

  return headers;
}

function readRequestBody(request: Request): Record<string, unknown> | undefined {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }

  if (!request.body || Object.keys(request.body).length === 0) {
    return undefined;
  }

  return request.body as Record<string, unknown>;
}

function isOpenAIChatCompletionsRequest(request: Request): boolean {
  return request.path === "/v1/chat/completions" || request.path === "/chat/completions";
}

function isOpenAIResponsesRequest(request: Request): boolean {
  return request.path === "/v1/responses" || request.path === "/responses";
}

function isOpenAIImageGenerationRequest(request: Request): boolean {
  return request.path === "/v1/images/generations" || request.path === "/images/generations";
}

function getSupportedOpenAIModelsForRequest(request: Request): readonly string[] | null {
  if (isOpenAIChatCompletionsRequest(request)) {
    return OPENAI_CHAT_COMPLETIONS_SUPPORTED_MODELS;
  }

  if (isOpenAIResponsesRequest(request)) {
    return OPENAI_RESPONSES_SUPPORTED_MODELS;
  }

  if (isOpenAIImageGenerationRequest(request)) {
    return OPENAI_IMAGE_GENERATION_SUPPORTED_MODELS;
  }

  return null;
}

function assertSupportedOpenAIModel(
  request: Request,
  body: Record<string, unknown> | undefined,
): void {
  if (!body || typeof body.model !== "string") {
    return;
  }

  const supportedModels = getSupportedOpenAIModelsForRequest(request);

  if (!supportedModels || supportedModels.includes(body.model)) {
    return;
  }

  throw new ApiError({
    status: 400,
    message: `Model ${body.model} is not supported on ${request.path}`,
    type: "invalid_request_error",
    code: "openai_model_not_supported_for_endpoint",
    details: {
      provider: "openai",
      endpoint: request.path,
      model: body.model,
    },
    logLevel: "warn",
  });
}

function normalizeOpenAIRequestBody(
  request: Request,
  body: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!body) {
    return body;
  }

  const maxTokens = body.max_tokens;
  const maxCompletionTokens = body.max_completion_tokens;

  if (isOpenAIChatCompletionsRequest(request)) {
    if (maxTokens === undefined && maxCompletionTokens === undefined) {
      return body;
    }

    const normalizedMaxCompletionTokens = maxCompletionTokens ?? maxTokens;
    const {
      max_tokens: _legacyMaxTokens,
      ...rest
    } = body;

    return normalizedMaxCompletionTokens === undefined
      ? rest
      : {
        ...rest,
        max_completion_tokens: normalizedMaxCompletionTokens,
      };
  }

  if (isOpenAIResponsesRequest(request)) {
    const normalizedMaxOutputTokens = body.max_output_tokens ?? maxCompletionTokens ?? maxTokens;

    if (normalizedMaxOutputTokens === undefined) {
      return body;
    }

    const {
      max_tokens: _legacyMaxTokens,
      max_completion_tokens: _chatCompletionMaxTokens,
      ...rest
    } = body;

    return {
      ...rest,
      max_output_tokens: normalizedMaxOutputTokens,
    };
  }

  return body;
}

async function readUpstreamError(upstream: globalThis.Response): Promise<unknown> {
  const raw = await upstream.text().catch(() => "");
  try {
    return JSON.parse(raw);
  } catch {
    return raw || upstream.statusText;
  }
}

function shouldAdjustOpenAIUsage(request: Request): boolean {
  return isOpenAIChatCompletionsRequest(request);
}

function maybeAdjustUsage(
  request: Request,
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (!shouldAdjustOpenAIUsage(request)) {
    return data;
  }

  const usage = data.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return data;
  }

  return {
    ...data,
    usage: applyBillingOai(usage as Record<string, number>),
  };
}

export async function handleOpenAIModelList(
  _request: Request,
  response: Response,
): Promise<void> {
  response.json(openAIModelList);
}

async function passthrough(
  request: Request,
  response: Response,
): Promise<void> {
  const requestLogger = getRequestLogger(request);
  const openai = getOpenAIProviderConfig();

  if (!openai.configured) {
    throw new ApiError({
      status: 503,
      message: "OpenAI provider not configured",
      type: "service_unavailable",
      code: "provider_integration_not_configured",
      details: { provider: "openai" },
      logLevel: "warn",
    });
  }

  const body = normalizeOpenAIRequestBody(request, readRequestBody(request));
  assertSupportedOpenAIModel(request, body);
  const target = buildTargetUrl(openai.baseUrl, request);
  const headers = buildOpenAIHeaders(openai.apiKey, request);
  const streamConfig = getProxyStreamConfig();
  const wantsStream = body?.stream === true;

  requestLogger.info(
    {
      method: request.method,
      target,
      model: body?.model,
      stream: wantsStream,
      providerSource: openai.source,
    },
    "OpenAI passthrough request",
  );

  const preparedUpstream = await prepareProxyUpstream({
    execute: async () => await fetch(target, {
      method: request.method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }),
    wantsStream,
    bootstrapRetries: streamConfig.streamBootstrapRetries,
    onRetry: (attempt, error) => {
      requestLogger.warn(
        {
          target,
          method: request.method,
          model: body?.model,
          attempt,
          retries: streamConfig.streamBootstrapRetries,
          error: error instanceof Error ? error.message : String(error),
        },
        "Retrying OpenAI stream bootstrap after upstream failure",
      );
    },
  });

  const {
    upstream,
    contentType,
    isStream,
    reader,
    firstChunk,
    streamDone,
  } = preparedUpstream;

  response.status(normalizeUpstreamStatus(upstream.status));
  response.setHeader("Content-Type", contentType);

  if (!upstream.ok) {
    const upstreamError = await readUpstreamError(upstream);
    const sanitizedUpstreamError = sanitizeUpstreamError(upstreamError);
    requestLogger.warn(
      {
        status: upstream.status,
        target,
        method: request.method,
        model: body?.model,
        upstreamError,
      },
      `OpenAI upstream ${upstream.status} error`,
    );

    response.end(
      typeof sanitizedUpstreamError === "string"
        ? sanitizedUpstreamError
        : JSON.stringify(sanitizedUpstreamError),
    );
    return;
  }

  if (isStream && upstream.body) {
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");

    if (!reader) {
      throw new Error("Prepared OpenAI stream is missing a reader.");
    }

    await pipeReaderToResponse(reader, response, {
      keepaliveIntervalMs: streamConfig.streamKeepaliveIntervalMs,
      firstChunk,
      streamDone,
    });
    return;
  }

  {
    const arrayBuffer = await readUpstreamArrayBufferWithKeepAlive(upstream, response, {
      keepaliveIntervalMs: streamConfig.nonStreamKeepaliveIntervalMs,
    });
    try {
      const data = JSON.parse(Buffer.from(arrayBuffer).toString()) as Record<string, unknown>;
      response.end(JSON.stringify(maybeAdjustUsage(request, data)));
    } catch {
      response.end(Buffer.from(arrayBuffer));
    }
  }
}

router.post("/v1/chat/completions", async (request, response) => {
  await passthrough(request, response);
});

router.post("/chat/completions", async (request, response) => {
  await passthrough(request, response);
});

router.post("/v1/responses", async (request, response) => {
  await passthrough(request, response);
});

router.post("/responses", async (request, response) => {
  await passthrough(request, response);
});

router.post("/v1/images/generations", async (request, response) => {
  await passthrough(request, response);
});

router.post("/images/generations", async (request, response) => {
  await passthrough(request, response);
});

export default router;
