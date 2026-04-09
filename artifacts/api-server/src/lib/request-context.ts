import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { Logger } from "pino";
import type { Options } from "pino-http";
import { logger } from "./logger";

export const REQUEST_ID_HEADER = "x-request-id";

type LoggedRequest = Request & {
  id?: string | number;
  log?: Logger;
};

function pickRequestId(headerValue: string | string[] | undefined): string | undefined {
  if (typeof headerValue === "string" && headerValue.trim()) {
    return headerValue.trim();
  }

  return undefined;
}

function getClientIp(req: Request): string | string[] | undefined {
  return req.headers["x-forwarded-for"] || req.socket?.remoteAddress;
}

export function getRequestId(req: Request): string {
  const request = req as LoggedRequest;
  const requestId = request.id;

  if (typeof requestId === "string" && requestId) {
    return requestId;
  }

  if (typeof requestId === "number") {
    return String(requestId);
  }

  return pickRequestId(req.headers[REQUEST_ID_HEADER]) ?? "unknown";
}

export function getRequestLogger(req: Request): Logger {
  return (req as LoggedRequest).log ?? logger;
}

export function createHttpLoggerOptions(): Options {
  return {
    logger,
    genReqId(req, res) {
      const requestId = pickRequestId(req.headers[REQUEST_ID_HEADER]) ?? randomUUID();
      res.setHeader(REQUEST_ID_HEADER, requestId);
      return requestId;
    },
    customSuccessMessage(req, res) {
      return `request completed (${req.method} ${req.url} -> ${res.statusCode})`;
    },
    customErrorMessage(req, res, error) {
      return `request failed (${req.method} ${req.url} -> ${res.statusCode}): ${error.message}`;
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
          query: req.query && Object.keys(req.query).length ? req.query : undefined,
          ip: getClientIp(req),
          userAgent: req.headers["user-agent"],
          contentType: req.headers["content-type"],
          contentLength: req.headers["content-length"]
            ? Number(req.headers["content-length"])
            : undefined,
          authorization: req.headers["authorization"] ? "[REDACTED]" : undefined,
          xApiKey: req.headers["x-api-key"] ? "[REDACTED]" : undefined,
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
          contentType: res.getHeader?.("content-type"),
          contentLength: res.getHeader?.("content-length"),
          requestId: res.getHeader?.(REQUEST_ID_HEADER),
        };
      },
    },
  };
}
