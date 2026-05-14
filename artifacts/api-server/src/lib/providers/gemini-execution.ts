import { ApiError } from "../api-error";
import type { GeminiProviderConfig } from "../gemini-provider";
import { getProxyStreamConfig, prepareProxyUpstream } from "../proxy-stream";
import { pipeReaderToSink } from "../stream";
import { normalizeUpstreamStatus } from "../upstream-error";
import { createUpstreamErrorResult, readHeaderValue } from "./common";
import {
  createBufferedExecutionResult,
  createStreamExecutionResult,
} from "./results";
import type {
  ProviderExecutionLogger,
  ProviderExecutionRequest,
  ProviderExecutionResult,
} from "./types";

const GEMINI_MAX_OUTPUT_TOKENS = 65536;

function buildTargetUrl(baseUrl: string, request: ProviderExecutionRequest): string {
  const cleanBaseUrl = baseUrl.replace(/\/$/, "");
  const normalizedBaseUrl = cleanBaseUrl.replace(/\/v\d+(beta)?$/i, "");
  const normalizedPath = request.path.replace(/^\/gemini\//, "/");
  const upstreamPath = normalizedPath.replace(/^\/v\d+(beta)?\//i, "/").replace(/^\//, "");
  const query = request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : "";
  return `${normalizedBaseUrl}/${upstreamPath}${query}`;
}

function buildGeminiHeaders(
  request: ProviderExecutionRequest,
  apiKey: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "x-goog-api-key": apiKey,
  };

  const contentType = readHeaderValue(request.headers, "content-type");
  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  return headers;
}

function normalizeGeminiRequestBody(
  body: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!body) {
    return body;
  }

  const generationConfig = body.generationConfig;
  if (!generationConfig || typeof generationConfig !== "object" || Array.isArray(generationConfig)) {
    return body;
  }

  const maxOutputTokens = (generationConfig as Record<string, unknown>).maxOutputTokens;
  if (
    typeof maxOutputTokens !== "number"
    || !Number.isFinite(maxOutputTokens)
    || maxOutputTokens <= GEMINI_MAX_OUTPUT_TOKENS
  ) {
    return body;
  }

  return {
    ...body,
    generationConfig: {
      ...(generationConfig as Record<string, unknown>),
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
    },
  };
}

export async function executeGeminiRequest(params: {
  request: ProviderExecutionRequest;
  provider: GeminiProviderConfig;
  logger: ProviderExecutionLogger;
  fetchImpl?: typeof fetch;
  abortSignal?: AbortSignal;
}): Promise<ProviderExecutionResult> {
  if (!params.provider.configured) {
    throw new ApiError({
      status: 503,
      message: "Gemini provider not configured",
      type: "service_unavailable",
      code: "provider_integration_not_configured",
      details: { provider: "gemini" },
      logLevel: "warn",
    });
  }

  const body = normalizeGeminiRequestBody(params.request.body);
  const target = buildTargetUrl(params.provider.baseUrl, params.request);
  const headers = buildGeminiHeaders(params.request, params.provider.apiKey);
  const streamConfig = getProxyStreamConfig();
  const wantsStream = params.request.path.includes(":streamGenerateContent");
  const executeFetch = params.fetchImpl ?? fetch;

  params.logger.info(
    {
      method: params.request.method,
      target,
      stream: wantsStream,
      providerSource: params.provider.source,
    },
    "Gemini passthrough request",
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
          attempt,
          retries: streamConfig.streamBootstrapRetries,
          error: error instanceof Error ? error.message : String(error),
        },
        "Retrying Gemini stream bootstrap after upstream failure",
      );
    },
  });

  const {
    upstream,
    contentType,
    isStream,
    reader,
    firstReadPromise,
    firstChunk,
    streamDone,
  } = preparedUpstream;

  if (!upstream.ok) {
    return await createUpstreamErrorResult({
      upstream,
      logger: params.logger,
      logMessage: `Gemini upstream ${upstream.status} error`,
      logBindings: {
        target,
        method: params.request.method,
      },
    });
  }

  if (isStream && upstream.body) {
    if (!reader) {
      throw new Error("Prepared Gemini stream is missing a reader.");
    }

    return createStreamExecutionResult({
      status: normalizeUpstreamStatus(upstream.status),
      contentType,
      pipeToSink: async (sink, options) => {
        await pipeReaderToSink(reader, sink, {
          firstReadPromise,
          firstChunk,
          streamDone,
          keepaliveIntervalMs: options?.keepaliveIntervalMs,
          keepaliveChunk: options?.keepaliveChunk,
        });
      },
    });
  }

  return createBufferedExecutionResult({
    status: normalizeUpstreamStatus(upstream.status),
    contentType,
    readBody: async () => new Uint8Array(await upstream.arrayBuffer()),
  });
}
