import type { NextFunction, Request, Response } from "express";
import { getRequestId, getRequestLogger } from "./request-context";

export interface ApiErrorShape {
  message: string;
  type: string;
}

export class ApiError extends Error {
  status: number;
  type: string;
  code: string;
  details?: unknown;
  logLevel: "warn" | "error";
  cause?: unknown;

  constructor(options: {
    status: number;
    message: string;
    code: string;
    type?: string;
    details?: unknown;
    logLevel?: "warn" | "error";
    cause?: unknown;
  }) {
    super(options.message);
    this.name = "ApiError";
    this.status = options.status;
    this.type = options.type ?? "invalid_request_error";
    this.code = options.code;
    this.details = options.details;
    this.logLevel = options.logLevel ?? (options.status >= 500 ? "error" : "warn");
    this.cause = options.cause;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function buildApiErrorPayload(
  _requestId: string,
  error: ApiError,
): { error: ApiErrorShape } {
  return {
    error: {
      message: error.message,
      type: error.type,
    },
  };
}

export function createInternalServerError(error: unknown): ApiError {
  return new ApiError({
    status: 500,
    message: "Internal proxy error",
    type: "server_error",
    code: "internal_proxy_error",
    logLevel: "error",
    cause: error,
  });
}

export function handleRouteError(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const apiError = isApiError(error) ? error : createInternalServerError(error);
  const requestId = getRequestId(req);
  const requestLogger = getRequestLogger(req);

  if (apiError.logLevel === "error") {
    requestLogger.error(
      {
        requestId,
        status: apiError.status,
        code: apiError.code,
        err: error instanceof Error ? error : undefined,
        details: apiError.details,
      },
      apiError.message,
    );
  } else {
    requestLogger.warn(
      {
        requestId,
        status: apiError.status,
        code: apiError.code,
        details: apiError.details,
      },
      apiError.message,
    );
  }

  res.status(apiError.status).json(buildApiErrorPayload(requestId, apiError));
}
