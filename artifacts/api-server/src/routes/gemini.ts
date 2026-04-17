import { Router, type Request, type Response } from "express";
import { ApiError } from "../lib/api-error";
import { getGeminiProviderConfig } from "../lib/gemini-provider";
import { getRequestLogger } from "../lib/request-context";
import { pipeReaderToResponse } from "../lib/stream";

const router = Router();

function isGoogleGeminiBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === "generativelanguage.googleapis.com";
  } catch {
    return false;
  }
}

function buildTargetUrl(baseUrl: string, request: Request): string {
  const cleanBaseUrl = baseUrl.replace(/\/$/, "");
  const googleUpstream = isGoogleGeminiBaseUrl(cleanBaseUrl);
  const normalizedBaseUrl = googleUpstream
    ? cleanBaseUrl.replace(/\/v\d+(beta)?$/i, "")
    : cleanBaseUrl;
  const normalizedPath = request.path.replace(/^\/gemini\//, "/");
  const upstreamPath = (
    googleUpstream || /\/v\d+(beta)?$/i.test(cleanBaseUrl)
      ? normalizedPath.replace(/^\/v\d+(beta)?\//i, "/")
      : normalizedPath
  ).replace(/^\//, "");
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

  const body = readRequestBody(request);
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

  response.end(Buffer.from(await upstream.arrayBuffer()));
}

export async function proxyGeminiRequest(
  request: Request,
  response: Response,
): Promise<void> {
  await passthrough(request, response);
}

router.use("/", async (request, response) => {
  await passthrough(request, response);
});

export default router;
