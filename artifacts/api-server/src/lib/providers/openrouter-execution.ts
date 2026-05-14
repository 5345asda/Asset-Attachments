import { ApiError } from "../api-error";
import { applyBillingOai } from "../billing";
import type { OpenRouterProviderConfig } from "../openrouter-provider";
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

export const OPENROUTER_OFFICIAL_MODEL_LIST_URL = "https://openrouter.ai/api/v1/models";

function buildTargetUrl(baseUrl: string, request: ProviderExecutionRequest): string {
  const cleanBaseUrl = baseUrl.replace(/\/$/, "");
  const upstreamPath = request.path.replace(/^\/v1\//, "").replace(/^\//, "");
  const query = request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : "";
  return `${cleanBaseUrl}/${upstreamPath}${query}`;
}

export function buildOpenRouterModelListUrl(
  baseUrl: string,
  source: OpenRouterProviderConfig["source"],
): string {
  if (source === "replit_integration") {
    return OPENROUTER_OFFICIAL_MODEL_LIST_URL;
  }

  return `${baseUrl.replace(/\/$/, "")}/models`;
}

export function buildOpenRouterHeaders(
  apiKey: string,
  request?: ProviderExecutionRequest,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };

  const contentType = request ? readHeaderValue(request.headers, "content-type") : "";
  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  if (request) {
    const referer = readHeaderValue(request.headers, "http-referer");
    const title = readHeaderValue(request.headers, "x-title");
    if (referer) {
      headers["HTTP-Referer"] = referer;
    }
    if (title) {
      headers["X-Title"] = title;
    }
  }

  return headers;
}

export async function executeOpenRouterRequest(params: {
  request: ProviderExecutionRequest;
  provider: OpenRouterProviderConfig;
  logger: ProviderExecutionLogger;
  fetchImpl?: typeof fetch;
  abortSignal?: AbortSignal;
}): Promise<ProviderExecutionResult> {
  if (!params.provider.configured) {
    throw new ApiError({
      status: 503,
      message: "OpenRouter provider not configured",
      type: "service_unavailable",
      code: "provider_integration_not_configured",
      details: { provider: "openrouter" },
      logLevel: "warn",
    });
  }

  const body = params.request.body;
  const target = buildTargetUrl(params.provider.baseUrl, params.request);
  const headers = buildOpenRouterHeaders(params.provider.apiKey, params.request);
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
      tools: Array.isArray(body?.tools) ? body.tools.length : undefined,
    },
    "OpenRouter passthrough request",
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
        "Retrying OpenRouter stream bootstrap after upstream failure",
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
      logMessage: `OpenRouter upstream ${upstream.status} error`,
      logBindings: {
        target,
        method: params.request.method,
        model: body?.model,
      },
    });
  }

  if (isStream && upstream.body) {
    if (!reader) {
      throw new Error("Prepared OpenRouter stream is missing a reader.");
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
    readBody: async () => {
      const arrayBuffer = await upstream.arrayBuffer();
      try {
        const data = JSON.parse(Buffer.from(arrayBuffer).toString("utf8")) as Record<string, any>;
        if (data.usage) {
          data.usage = applyBillingOai(data.usage);
        }
        return Buffer.from(JSON.stringify(data), "utf8");
      } catch {
        return new Uint8Array(arrayBuffer);
      }
    },
  });
}
