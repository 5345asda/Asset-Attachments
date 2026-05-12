import { Router, type Request, type Response } from "express";
import { ApiError } from "../lib/api-error";
import { applyBillingOai } from "../lib/billing";
import { getOpenRouterProviderConfig } from "../lib/openrouter-provider";
import { getProxyStreamConfig, prepareProxyUpstream } from "../lib/proxy-stream";
import { getRequestLogger } from "../lib/request-context";
import { pipeReaderToResponse, readUpstreamArrayBufferWithKeepAlive } from "../lib/stream";
import { normalizeUpstreamStatus, sanitizeUpstreamError } from "../lib/upstream-error";

const router = Router();

export const openRouterEmptyModelList = {
  data: [],
};
const OPENROUTER_OFFICIAL_MODEL_LIST_URL = "https://openrouter.ai/api/v1/models";

function buildTargetUrl(baseUrl: string, request: Request): string {
  const cleanBaseUrl = baseUrl.replace(/\/$/, "");
  const upstreamPath = request.path.replace(/^\/v1\//, "").replace(/^\//, "");
  const query = request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : "";
  return `${cleanBaseUrl}/${upstreamPath}${query}`;
}

function buildModelListUrl(
  baseUrl: string,
  source: ReturnType<typeof getOpenRouterProviderConfig>["source"],
): string {
  if (source === "replit_integration") {
    return OPENROUTER_OFFICIAL_MODEL_LIST_URL;
  }

  return `${baseUrl.replace(/\/$/, "")}/models`;
}

function buildOpenRouterHeaders(apiKey: string, request?: Request): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };

  if (request?.headers["content-type"]) {
    headers["Content-Type"] = request.headers["content-type"] as string;
  }

  const referer = request?.headers["http-referer"];
  if (typeof referer === "string" && referer.trim()) {
    headers["HTTP-Referer"] = referer;
  }

  const title = request?.headers["x-title"];
  if (typeof title === "string" && title.trim()) {
    headers["X-Title"] = title;
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

async function readUpstreamError(upstream: globalThis.Response): Promise<unknown> {
  const raw = await upstream.text().catch(() => "");
  try {
    return JSON.parse(raw);
  } catch {
    return raw || upstream.statusText;
  }
}

export async function handleOpenRouterModelList(
  request: Request,
  response: Response,
): Promise<void> {
  const requestLogger = getRequestLogger(request);
  const openrouter = getOpenRouterProviderConfig();

  if (!openrouter.configured) {
    response.json(openRouterEmptyModelList);
    return;
  }

  const target = buildModelListUrl(openrouter.baseUrl, openrouter.source);
  const upstream = await fetch(target, {
    method: "GET",
    headers: buildOpenRouterHeaders(openrouter.apiKey),
  });

  if (!upstream.ok) {
    const upstreamError = await readUpstreamError(upstream);
    const sanitizedUpstreamError = sanitizeUpstreamError(upstreamError);

    const contentType = upstream.headers.get("content-type") || "application/json";
    response.status(normalizeUpstreamStatus(upstream.status));
    response.setHeader("Content-Type", contentType);

    requestLogger.warn(
      {
        status: upstream.status,
        target,
        method: request.method,
        upstreamError,
      },
      `OpenRouter upstream ${upstream.status} error`,
    );

    response.end(
      typeof sanitizedUpstreamError === "string"
        ? sanitizedUpstreamError
        : JSON.stringify(sanitizedUpstreamError),
    );
    return;
  }

  const contentType = upstream.headers.get("content-type") || "application/json";
  response.status(normalizeUpstreamStatus(upstream.status));
  response.setHeader("Content-Type", contentType);
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

async function passthrough(
  request: Request,
  response: Response,
): Promise<void> {
  const requestLogger = getRequestLogger(request);
  const openrouter = getOpenRouterProviderConfig();

  if (!openrouter.configured) {
    throw new ApiError({
      status: 503,
      message: "OpenRouter provider not configured",
      type: "service_unavailable",
      code: "provider_integration_not_configured",
      details: { provider: "openrouter" },
      logLevel: "warn",
    });
  }

  const body = readRequestBody(request);
  const target = buildTargetUrl(openrouter.baseUrl, request);
  const headers = buildOpenRouterHeaders(openrouter.apiKey, request);
  const streamConfig = getProxyStreamConfig();
  const wantsStream = body?.stream === true;

  requestLogger.info(
    {
      method: request.method,
      target,
      model: body?.model,
      stream: wantsStream,
      providerSource: openrouter.source,
      tools: Array.isArray(body?.tools) ? body.tools.length : undefined,
    },
    "OpenRouter passthrough request",
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
      `OpenRouter upstream ${upstream.status} error`,
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
      throw new Error("Prepared OpenRouter stream is missing a reader.");
    }

    await pipeReaderToResponse(reader, response, {
      keepaliveIntervalMs: streamConfig.streamKeepaliveIntervalMs,
      firstReadPromise,
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
      const data = JSON.parse(Buffer.from(arrayBuffer).toString());
      if (data?.usage) {
        data.usage = applyBillingOai(data.usage);
      }
      response.end(JSON.stringify(data));
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

export default router;
