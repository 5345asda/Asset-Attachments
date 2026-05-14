import type { NextFunction, Request, Response } from "express";
import { ApiError } from "./api-error";
import { getInternalRunsConfig } from "./internal-run-config";

function readHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0]?.trim() || "";
  }

  return value?.trim() || "";
}

export function requireInternalRunsAuth(req: Request, _res: Response, next: NextFunction): void {
  const config = getInternalRunsConfig();
  if (!config.tokenConfigured) {
    next(new ApiError({
      status: 503,
      message: "Internal runs token not configured",
      type: "server_error",
      code: "internal_runs_token_not_configured",
      logLevel: "warn",
    }));
    return;
  }

  const authorization = readHeaderValue(req.headers.authorization);
  const internalToken = readHeaderValue(req.headers["x-internal-runs-token"]);
  const bearerToken = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const providedToken = bearerToken || internalToken;

  if (!providedToken || providedToken !== config.token) {
    next(new ApiError({
      status: 401,
      message: "Unauthorized - invalid or missing internal token",
      code: "unauthorized_internal_runs",
      details: {
        hasAuthorization: Boolean(authorization),
        hasInternalToken: Boolean(internalToken),
      },
      logLevel: "warn",
    }));
    return;
  }

  next();
}
