import { normalizeUpstreamStatus, sanitizeUpstreamError } from "../upstream-error";
import { createBufferedExecutionResult, encodeExecutionPayload } from "./results";
import type { ProviderExecutionResult } from "./types";

export function readHeaderValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string {
  const value = headers[name.toLowerCase()] ?? headers[name];
  if (Array.isArray(value)) {
    return value[0]?.trim() || "";
  }

  return typeof value === "string" ? value.trim() : "";
}

export async function readUpstreamError(upstream: globalThis.Response): Promise<unknown> {
  const raw = await upstream.text().catch(() => "");
  try {
    return JSON.parse(raw);
  } catch {
    return raw || upstream.statusText;
  }
}

export async function createUpstreamErrorResult(params: {
  upstream: globalThis.Response;
  logger: {
    warn: (bindings: unknown, message?: string) => void;
  };
  logMessage: string;
  logBindings: Record<string, unknown>;
}): Promise<ProviderExecutionResult> {
  const upstreamError = await readUpstreamError(params.upstream);
  const sanitizedUpstreamError = sanitizeUpstreamError(upstreamError);
  const contentType = params.upstream.headers.get("content-type") || "application/json";

  params.logger.warn(
    {
      ...params.logBindings,
      status: params.upstream.status,
      upstreamError: sanitizedUpstreamError,
    },
    params.logMessage,
  );

  return createBufferedExecutionResult({
    status: normalizeUpstreamStatus(params.upstream.status),
    contentType,
    readBody: async () => encodeExecutionPayload(sanitizedUpstreamError),
  });
}
