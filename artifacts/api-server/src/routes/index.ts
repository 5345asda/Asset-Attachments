import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import healthRouter from "./health";
import proxyRouter from "./proxy";
import passthroughRouter from "./passthrough";
import { PROXY_API_KEY } from "../lib/proxy-key";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function proxyAuth(req: Request, res: Response, next: NextFunction) {
  if (!PROXY_API_KEY) {
    logger.warn({ url: req.url, method: req.method }, "Auth skipped: PROXY_API_KEY not configured");
    res.status(503).json({ error: { message: "Proxy API key not configured", type: "server_error" } });
    return;
  }

  const auth = req.headers["authorization"];
  const xApiKey = req.headers["x-api-key"];
  const bearerOk = typeof auth === "string" && auth === `Bearer ${PROXY_API_KEY}`;
  const xApiKeyOk = typeof xApiKey === "string" && xApiKey === PROXY_API_KEY;

  if (!bearerOk && !xApiKeyOk) {
    const reason = !auth && !xApiKey
      ? "missing_auth_header"
      : auth && !bearerOk
        ? "invalid_bearer_token"
        : "invalid_x_api_key";

    logger.warn(
      {
        url: req.url,
        method: req.method,
        reason,
        hasAuthorization: !!auth,
        hasXApiKey: !!xApiKey,
        authScheme: auth ? auth.split(" ")[0] : undefined,
      },
      "Auth failed: 401 Unauthorized",
    );

    res.status(401).json({ error: { message: "Unauthorized - invalid or missing API key", type: "invalid_request_error" } });
    return;
  }

  logger.debug({ url: req.url, method: req.method, via: bearerOk ? "bearer" : "x-api-key" }, "Auth passed");
  next();
}

router.use(healthRouter);

router.use("/v1", proxyAuth, proxyRouter);

router.use("/", proxyAuth, passthroughRouter);

export default router;
