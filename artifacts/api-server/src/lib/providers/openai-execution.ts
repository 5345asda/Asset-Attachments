import { ApiError } from "../api-error";
import { applyBillingOai } from "../billing";
import {
  OPENAI_CHAT_COMPLETIONS_SUPPORTED_MODELS,
  OPENAI_IMAGE_GENERATION_SUPPORTED_MODELS,
  OPENAI_RESPONSES_SUPPORTED_MODELS,
} from "../openai-models";
import type { OpenAIProviderConfig } from "../openai-provider";
import { getProxyStreamConfig, prepareProxyUpstream } from "../proxy-stream";
import { normalizeUpstreamStatus } from "../upstream-error";
import { createUpstreamErrorResult, readHeaderValue } from "./common";
import {
  createBufferedExecutionResult,
  createStreamExecutionResult,
} from "./results";
import { pipeReaderToSink } from "../stream";
import type {
  ProviderExecutionRequest,
  ProviderExecutionResult,
  ProviderExecutionLogger,
} from "./types";

function buildTargetUrl(baseUrl: string, request: ProviderExecutionRequest): string {
  const cleanBaseUrl = baseUrl.replace(/\/$/, "");
  const upstreamPath = request.path.replace(/^\/v1\//, "").replace(/^\//, "");
  const query = request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : "";
  return `${cleanBaseUrl}/${upstreamPath}${query}`;
}

function buildOpenAIHeaders(
  apiKey: string,
  request: ProviderExecutionRequest,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };

  const contentType = readHeaderValue(request.headers, "content-type");
  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  const forwardHeaderNames = [
    "openai-organization",
    "openai-project",
    "openai-beta",
    "idempotency-key",
  ] as const;

  for (const headerName of forwardHeaderNames) {
    const value = readHeaderValue(request.headers, headerName);
    if (value) {
      headers[headerName] = value;
    }
  }

  return headers;
}

function isOpenAIChatCompletionsRequest(request: ProviderExecutionRequest): boolean {
  return request.path === "/v1/chat/completions" || request.path === "/chat/completions";
}

function isOpenAIResponsesRequest(request: ProviderExecutionRequest): boolean {
  return request.path === "/v1/responses" || request.path === "/responses";
}

function isOpenAIImageGenerationRequest(request: ProviderExecutionRequest): boolean {
  return request.path === "/v1/images/generations" || request.path === "/images/generations";
}

function getSupportedOpenAIModelsForRequest(
  request: ProviderExecutionRequest,
): readonly string[] | null {
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
  request: ProviderExecutionRequest,
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
  request: ProviderExecutionRequest,
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

function shouldAdjustOpenAIUsage(request: ProviderExecutionRequest): boolean {
  return isOpenAIChatCompletionsRequest(request);
}

function maybeAdjustUsage(
  request: ProviderExecutionRequest,
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

export async function executeOpenAIRequest(params: {
  request: ProviderExecutionRequest;
  provider: OpenAIProviderConfig;
  logger: ProviderExecutionLogger;
  fetchImpl?: typeof fetch;
  abortSignal?: AbortSignal;
}): Promise<ProviderExecutionResult> {
  if (!params.provider.configured) {
    throw new ApiError({
      status: 503,
      message: "OpenAI provider not configured",
      type: "service_unavailable",
      code: "provider_integration_not_configured",
      details: { provider: "openai" },
      logLevel: "warn",
    });
  }

  const body = normalizeOpenAIRequestBody(params.request, params.request.body);
  assertSupportedOpenAIModel(params.request, body);
  const target = buildTargetUrl(params.provider.baseUrl, params.request);
  const headers = buildOpenAIHeaders(params.provider.apiKey, params.request);
  const streamConfig = getProxyStreamConfig();
  const wantsStream = body?.stream === true;
  const executeFetch = params.fetchImpl ?? fetch;

  params.logger.info(
    {
      method: params.request.method,
      target,
      model: body?.model,
      stream: wantsStream,
      providerSource: params.provider.source,
    },
    "OpenAI passthrough request",
  );

  const preparedUpstream = await prepareProxyUpstream({
    execute: async () => await executeFetch(target, {
      method: params.request.method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: params.abortSignal,
    }),
    wantsStream,
    bootstrapRetries: streamConfig.streamBootstrapRetries,
    onRetry: (attempt, error) => {
      params.logger.warn(
        {
          target,
          method: params.request.method,
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
    firstReadPromise,
  } = preparedUpstream;

  if (!upstream.ok) {
    return await createUpstreamErrorResult({
      upstream,
      logger: params.logger,
      logMessage: `OpenAI upstream ${upstream.status} error`,
      logBindings: {
        target,
        method: params.request.method,
        model: body?.model,
      },
    });
  }

  if (isStream && upstream.body) {
    if (!reader) {
      throw new Error("Prepared OpenAI stream is missing a reader.");
    }

    return createStreamExecutionResult({
      status: normalizeUpstreamStatus(upstream.status),
      contentType,
      pipeToSink: async (sink, options) => {
        await pipeReaderToSink(reader, sink, {
          firstReadPromise,
          keepaliveIntervalMs: options?.keepaliveIntervalMs,
          keepaliveChunk: options?.keepaliveChunk,
        });
      },
    });
  }

  return createBufferedExecutionResult({
    status: normalizeUpstreamStatus(upstream.status),
    contentType,
    readBody: async () => {
      const arrayBuffer = await upstream.arrayBuffer();
      try {
        const data = JSON.parse(Buffer.from(arrayBuffer).toString("utf8")) as Record<string, unknown>;
        return Buffer.from(JSON.stringify(maybeAdjustUsage(params.request, data)), "utf8");
      } catch {
        return new Uint8Array(arrayBuffer);
      }
    },
  });
}
