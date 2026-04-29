import { Router, type Request, type Response } from "express";
import { ApiError } from "../lib/api-error";
import { applyBillingOai } from "../lib/billing";
import { getOpenAIProviderConfig } from "../lib/openai-provider";
import { getRequestLogger } from "../lib/request-context";
import { pipeReaderToResponse } from "../lib/stream";
import { sanitizeUpstreamError } from "../lib/upstream-error";

const router = Router();

export const OPENAI_SUPPORTED_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.3-codex",
  "gpt-5.2",
  "gpt-5.1",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o",
  "gpt-4o-mini",
  "o3",
  "o4-mini",
  "o3-mini",
  "gpt-image-1",
  "gpt-image-2",
] as const;

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

async function readUpstreamError(upstream: globalThis.Response): Promise<unknown> {
  const raw = await upstream.text().catch(() => "");
  try {
    return JSON.parse(raw);
  } catch {
    return raw || upstream.statusText;
  }
}

function shouldAdjustOpenAIUsage(request: Request): boolean {
  return request.path === "/v1/chat/completions" || request.path === "/chat/completions";
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

  const body = readRequestBody(request);
  const target = buildTargetUrl(openai.baseUrl, request);
  const headers = buildOpenAIHeaders(openai.apiKey, request);

  requestLogger.info(
    {
      method: request.method,
      target,
      model: body?.model,
      stream: !!body?.stream,
      providerSource: openai.source,
    },
    "OpenAI passthrough request",
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

    const reader = upstream.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    await pipeReaderToResponse(reader, response);
    return;
  }

  {
    const arrayBuffer = await upstream.arrayBuffer();
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
