import { Router, type Request, type Response } from "express";
import { ApiError } from "../lib/api-error";
import { getGeminiProviderConfig } from "../lib/gemini-provider";
import { getRequestLogger } from "../lib/request-context";
import { pipeReaderToResponse } from "../lib/stream";
import { sanitizeUpstreamError } from "../lib/upstream-error";

const router = Router();
const GEMINI_MAX_OUTPUT_TOKENS = 65536;

function buildTargetUrl(baseUrl: string, request: Request): string {
  const cleanBaseUrl = baseUrl.replace(/\/$/, "");
  const normalizedBaseUrl = cleanBaseUrl.replace(/\/v\d+(beta)?$/i, "");
  const normalizedPath = request.path.replace(/^\/gemini\//, "/");
  const upstreamPath = normalizedPath.replace(/^\/v\d+(beta)?\//i, "/").replace(/^\//, "");
  const query = request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : "";
  return `${normalizedBaseUrl}/${upstreamPath}${query}`;
}

function buildGeminiHeaders(request: Request, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    "x-goog-api-key": apiKey,
  };

  if (request.headers["content-type"]) {
    headers["Content-Type"] = request.headers["content-type"] as string;
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
  if (typeof maxOutputTokens !== "number" || !Number.isFinite(maxOutputTokens) || maxOutputTokens <= GEMINI_MAX_OUTPUT_TOKENS) {
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

async function readUpstreamError(upstream: globalThis.Response): Promise<unknown> {
  const raw = await upstream.text().catch(() => "");
  try {
    return JSON.parse(raw);
  } catch {
    return raw || upstream.statusText;
  }
}

async function passthrough(
  request: Request,
  response: Response,
): Promise<void> {
  const requestLogger = getRequestLogger(request);
  const gemini = getGeminiProviderConfig();

  if (!gemini.configured) {
    throw new ApiError({
      status: 503,
      message: "Gemini provider not configured",
      type: "service_unavailable",
      code: "provider_integration_not_configured",
      details: { provider: "gemini" },
      logLevel: "warn",
    });
  }

  const body = normalizeGeminiRequestBody(readRequestBody(request));
  const target = buildTargetUrl(gemini.baseUrl, request);
  const headers = buildGeminiHeaders(request, gemini.apiKey);

  requestLogger.info(
    {
      method: request.method,
      target,
      stream: request.path.includes(":streamGenerateContent"),
      providerSource: gemini.source,
    },
    "Gemini passthrough request",
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
        upstreamError,
      },
      `Gemini upstream ${upstream.status} error`,
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

  response.end(Buffer.from(await upstream.arrayBuffer()));
}

router.use("/", async (request, response) => {
  await passthrough(request, response);
});

export default router;
