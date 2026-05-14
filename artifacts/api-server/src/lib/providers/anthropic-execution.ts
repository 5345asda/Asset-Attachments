import { ApiError } from "../api-error";
import {
  prepareAnthropicStructuredOutputRequest,
  restoreAnthropicStructuredOutputResponse,
  type AnthropicStructuredOutputShim,
} from "../anthropic-structured-output";
import { normalizeAnthropicResponseMessage } from "../anthropic-message-id";
import { sanitizeAnthropicBody } from "../anthropic-request";
import { applyBillingAnthropic } from "../billing";
import type { AnthropicProviderConfig } from "../anthropic-provider";
import { getProxyStreamConfig, prepareProxyUpstream } from "../proxy-stream";
import { normalizeUpstreamStatus } from "../upstream-error";
import { pipeAnthropicStreamWithUsageAdjustToSink } from "../stream";
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

const PROMPT_CACHING_BETA = "prompt-caching-2024-07-31";
const TASK_BUDGETS_BETA = "task-budgets-2026-03-13";
const OBSOLETE_BETAS = new Set([
  "effort-2025-11-24",
  "fine-grained-tool-streaming-2025-05-14",
  "web-search-2025-03-05",
]);
const OPUS_47_OBSOLETE_BETAS = new Set(["interleaved-thinking-2025-05-14"]);

function buildTargetUrl(baseUrl: string, request: ProviderExecutionRequest): string {
  const cleanBaseUrl = baseUrl.replace(/\/$/, "");
  const upstreamPath = request.path.replace(/^\/v1\//, "").replace(/^\//, "");
  const query = request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : "";
  return `${cleanBaseUrl}/${upstreamPath}${query}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function needsTaskBudgetBeta(body: Record<string, unknown> | undefined): boolean {
  return isRecord(body?.output_config) && isRecord(body.output_config.task_budget);
}

function buildAnthropicHeaders(
  request: ProviderExecutionRequest,
  apiKey: string,
  body?: Record<string, unknown>,
): Record<string, string> {
  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "anthropic-version": readHeaderValue(request.headers, "anthropic-version") || "2023-06-01",
  };

  const contentType = readHeaderValue(request.headers, "content-type");
  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  const clientBeta = readHeaderValue(request.headers, "anthropic-beta");
  const isClaudeOpus47 = body?.model === "claude-opus-4-7";
  const requiredBetas = [PROMPT_CACHING_BETA];
  if (needsTaskBudgetBeta(body)) {
    requiredBetas.push(TASK_BUDGETS_BETA);
  }
  const mergedBetas = Array.from(new Set([
    ...(clientBeta
      ? clientBeta
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .filter((value) => !OBSOLETE_BETAS.has(value))
        .filter((value) => !isClaudeOpus47 || !OPUS_47_OBSOLETE_BETAS.has(value))
      : []),
    ...requiredBetas,
  ]));
  headers["anthropic-beta"] = mergedBetas.join(",");

  return headers;
}

export async function executeAnthropicRequest(params: {
  request: ProviderExecutionRequest;
  provider: AnthropicProviderConfig;
  logger: ProviderExecutionLogger;
  fetchImpl?: typeof fetch;
  abortSignal?: AbortSignal;
}): Promise<ProviderExecutionResult> {
  if (!params.provider.configured) {
    throw new ApiError({
      status: 503,
      message: "Anthropic provider not configured",
      type: "service_unavailable",
      code: "provider_integration_not_configured",
      details: { provider: "anthropic" },
      logLevel: "warn",
    });
  }

  let body = params.request.body;
  let structuredOutputShim: AnthropicStructuredOutputShim | undefined;
  if (body) {
    body = sanitizeAnthropicBody(body);
    const preparedStructuredOutput = prepareAnthropicStructuredOutputRequest(body);
    body = preparedStructuredOutput.body;
    structuredOutputShim = preparedStructuredOutput.shim;
  }

  const target = buildTargetUrl(params.provider.baseUrl, params.request);
  const headers = buildAnthropicHeaders(params.request, params.provider.apiKey, body);
  const streamConfig = getProxyStreamConfig();
  const executeFetch = params.fetchImpl ?? fetch;

  const { model, temperature, top_p, max_tokens, stream, tools } = body ?? {};
  params.logger.info(
    {
      method: params.request.method,
      target,
      model,
      temperature,
      top_p,
      max_tokens,
      stream: !!stream,
      providerSource: params.provider.source,
      structuredOutputShim: !!structuredOutputShim,
      tools: Array.isArray(tools) ? tools.length : undefined,
    },
    "Passthrough request",
  );

  const preparedUpstream = await prepareProxyUpstream({
    execute: async () => await executeFetch(target, {
      method: params.request.method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: params.abortSignal,
    }),
    wantsStream: stream === true,
    bootstrapRetries: streamConfig.streamBootstrapRetries,
    onRetry: (attempt, error) => {
      params.logger.warn(
        {
          target,
          method: params.request.method,
          model,
          attempt,
          retries: streamConfig.streamBootstrapRetries,
          error: error instanceof Error ? error.message : String(error),
        },
        "Retrying Anthropic stream bootstrap after upstream failure",
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
      logMessage: `Upstream ${upstream.status} error`,
      logBindings: {
        target,
        method: params.request.method,
        model,
        temperature,
        top_p,
      },
    });
  }

  if (isStream && upstream.body) {
    if (!reader) {
      throw new Error("Prepared Anthropic stream is missing a reader.");
    }

    return createStreamExecutionResult({
      status: normalizeUpstreamStatus(upstream.status),
      contentType,
      pipeToSink: async (sink, options) => {
        await pipeAnthropicStreamWithUsageAdjustToSink(reader, sink, {
          structuredOutputShim,
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
          data.usage = applyBillingAnthropic(data.usage);
        }

        return Buffer.from(
          JSON.stringify(
            normalizeAnthropicResponseMessage(
              restoreAnthropicStructuredOutputResponse(data, structuredOutputShim),
            ),
          ),
          "utf8",
        );
      } catch {
        return new Uint8Array(arrayBuffer);
      }
    },
  });
}
