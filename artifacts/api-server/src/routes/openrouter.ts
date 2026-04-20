import { Router, type Request, type Response } from "express";
import { ApiError } from "../lib/api-error";
import { applyBillingOai } from "../lib/billing";
import { getOpenRouterProviderConfig } from "../lib/openrouter-provider";
import { getRequestLogger } from "../lib/request-context";
import { pipeReaderToResponse } from "../lib/stream";

const router = Router();

export const openRouterEmptyModelList = {
  data: [],
};

function shouldFallbackOpenRouterModelList(
  source: ReturnType<typeof getOpenRouterProviderConfig>["source"],
  status: number,
): boolean {
  return source === "replit_integration" && status === 405;
}

function buildTargetUrl(baseUrl: string, request: Request): string {
  const cleanBaseUrl = baseUrl.replace(/\/$/, "");
  const upstreamPath = request.path.replace(/^\/v1\//, "").replace(/^\//, "");
  const query = request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : "";
  return `${cleanBaseUrl}/${upstreamPath}${query}`;
}

function buildModelListUrl(baseUrl: string): string {
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

  const target = buildModelListUrl(openrouter.baseUrl);
  const upstream = await fetch(target, {
    method: "GET",
    headers: buildOpenRouterHeaders(openrouter.apiKey),
  });

  if (!upstream.ok) {
    const upstreamError = await readUpstreamError(upstream);

    if (shouldFallbackOpenRouterModelList(openrouter.source, upstream.status)) {
      requestLogger.warn(
        {
          status: upstream.status,
          target,
          method: request.method,
          providerSource: openrouter.source,
          upstreamError,
        },
        "OpenRouter model list GET unsupported upstream; serving fallback model list",
      );

      response.json(openRouterEmptyModelList);
      return;
    }

    const contentType = upstream.headers.get("content-type") || "application/json";
    response.status(upstream.status);
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
      typeof upstreamError === "string" ? upstreamError : JSON.stringify(upstreamError),
    );
    return;
  }

  const contentType = upstream.headers.get("content-type") || "application/json";
  response.status(upstream.status);
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

  requestLogger.info(
    {
      method: request.method,
      target,
      model: body?.model,
      stream: !!body?.stream,
      providerSource: openrouter.source,
      tools: Array.isArray(body?.tools) ? body.tools.length : undefined,
    },
    "OpenRouter passthrough request",
  );

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = upstream.headers.get("content-type") || "application/json";
  const isStream =
    contentType.includes("text/event-stream") || contentType.includes("application/stream");

  response.status(upstream.status);
  response.setHeader("Content-Type", contentType);

  if (!upstream.ok) {
    const upstreamError = await readUpstreamError(upstream);
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
      typeof upstreamError === "string" ? upstreamError : JSON.stringify(upstreamError),
    );
    return;
  }

  if (isStream && upstream.body) {
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");

    const reader = upstream.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    await pipeReaderToResponse(reader, response);
    return;
  }

  {
    const arrayBuffer = await upstream.arrayBuffer();
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
