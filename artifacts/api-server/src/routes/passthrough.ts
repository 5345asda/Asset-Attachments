import { Router, type Request, type Response } from "express";
import { ApiError } from "../lib/api-error";
import {
  anthropicModelList,
  sanitizeAnthropicBody,
} from "../lib/anthropic-request";
import { getRequestLogger } from "../lib/request-context";
import {
  pipeAnthropicStreamWithUsageAdjust,
} from "../lib/stream";
import { applyBillingAnthropic } from "../lib/billing";

const router = Router();

function buildTargetUrl(baseUrl: string, request: Request): string {
  const cleanBaseUrl = baseUrl.replace(/\/$/, "");
  const upstreamPath = request.path.replace(/^\/v1\//, "").replace(/^\//, "");
  const query = request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : "";
  return `${cleanBaseUrl}/${upstreamPath}${query}`;
}

function buildAnthropicHeaders(request: Request, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "anthropic-version": typeof request.headers["anthropic-version"] === "string"
      ? request.headers["anthropic-version"] as string
      : "2023-06-01",
  };

  if (request.headers["content-type"]) {
    headers["Content-Type"] = request.headers["content-type"] as string;
  }

  const clientBeta = request.headers["anthropic-beta"] as string | undefined;
  const requiredBetas = ["prompt-caching-2024-07-31"];
  const mergedBetas = Array.from(new Set([
    ...(clientBeta ? clientBeta.split(",").map((value) => value.trim()).filter(Boolean) : []),
    ...requiredBetas,
  ]));
  headers["anthropic-beta"] = mergedBetas.join(",");

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
  const baseUrl = process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"] || "";
  const apiKey = process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"] || "";

  if (!baseUrl || !apiKey) {
    throw new ApiError({
      status: 503,
      message: "ANTHROPIC integration not configured",
      type: "service_unavailable",
      code: "provider_integration_not_configured",
      details: { provider: "anthropic" },
      logLevel: "warn",
    });
  }

  let body = readRequestBody(request);
  if (body) {
    body = sanitizeAnthropicBody(body);
  }

  const target = buildTargetUrl(baseUrl, request);
  const headers = buildAnthropicHeaders(request, apiKey);

  const { model, temperature, top_p, max_tokens, stream, tools } = body ?? {};
  requestLogger.info(
    {
      method: request.method,
      target,
      model,
      temperature,
      top_p,
      max_tokens,
      stream: !!stream,
      tools: Array.isArray(tools) ? tools.length : undefined,
    },
    "Passthrough request",
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
        model,
        temperature,
        top_p,
        upstreamError,
      },
      `Upstream ${upstream.status} error`,
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
    await pipeAnthropicStreamWithUsageAdjust(reader, response);
    return;
  }

  {
    const arrayBuffer = await upstream.arrayBuffer();
    try {
      const data = JSON.parse(Buffer.from(arrayBuffer).toString());
      if (data?.usage) {
        data.usage = applyBillingAnthropic(data.usage);
      }
      response.end(JSON.stringify(data));
    } catch {
      response.end(Buffer.from(arrayBuffer));
    }
  }
}

router.get("/v1/models", (_req, res) => res.json(anthropicModelList));
router.get("/models", (_req, res) => res.json(anthropicModelList));
router.use("/", async (request, response) => {
  await passthrough(request, response);
});

export default router;
