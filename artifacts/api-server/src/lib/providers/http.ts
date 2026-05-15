import type { Request, Response } from "express";
import type { ProxyStreamConfig } from "../proxy-stream";
import type {
  ProviderExecutionRequest,
  ProviderExecutionResult,
  ProviderResponseSink,
} from "./types";

export function readRequestBody(
  request: Request,
): Record<string, unknown> | undefined {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }

  if (!request.body || Object.keys(request.body).length === 0) {
    return undefined;
  }

  return request.body as Record<string, unknown>;
}

export function toProviderExecutionRequest(
  request: Request,
): ProviderExecutionRequest {
  return {
    method: request.method,
    path: request.path,
    url: request.url,
    headers: request.headers as Record<string, string | string[] | undefined>,
    body: readRequestBody(request),
  };
}

function toResponseSink(response: Response): ProviderResponseSink {
  return {
    write: async (chunk) => {
      if (!response.destroyed) {
        response.write(chunk);
      }
    },
    end: async () => {
      if (!response.destroyed) {
        response.end();
      }
    },
    isClosed: () => response.destroyed,
  };
}

export async function sendExecutionResult(
  response: Response,
  result: ProviderExecutionResult,
  streamConfig: ProxyStreamConfig,
): Promise<void> {
  response.status(result.status);
  response.setHeader("Content-Type", result.contentType);

  if (result.stream) {
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
  }

  await result.pipeToSink(toResponseSink(response), {
    keepaliveIntervalMs: result.stream
      ? streamConfig.streamKeepaliveIntervalMs
      : streamConfig.nonStreamKeepaliveIntervalMs,
    keepaliveChunk: result.stream ? ": ping\n\n" : "\n",
  });
}
