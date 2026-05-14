import { Router, type Request, type Response } from "express";
import { getOpenRouterProviderConfig } from "../lib/openrouter-provider";
import { getProxyStreamConfig } from "../lib/proxy-stream";
import { getRequestLogger } from "../lib/request-context";
import {
  buildOpenRouterHeaders,
  buildOpenRouterModelListUrl,
  executeOpenRouterRequest,
} from "../lib/providers/openrouter-execution";
import {
  sendExecutionResult,
  toProviderExecutionRequest,
} from "../lib/providers/http";
import { normalizeUpstreamStatus, sanitizeUpstreamError } from "../lib/upstream-error";

const router = Router();

export const openRouterEmptyModelList = {
  data: [],
};

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

  const target = buildOpenRouterModelListUrl(openrouter.baseUrl, openrouter.source);
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
        upstreamError: sanitizedUpstreamError,
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
  const result = await executeOpenRouterRequest({
    request: toProviderExecutionRequest(request),
    provider: getOpenRouterProviderConfig(),
    logger: getRequestLogger(request),
  });

  await sendExecutionResult(response, result, getProxyStreamConfig());
}

router.post("/v1/chat/completions", async (request, response) => {
  await passthrough(request, response);
});

router.post("/chat/completions", async (request, response) => {
  await passthrough(request, response);
});

export default router;
