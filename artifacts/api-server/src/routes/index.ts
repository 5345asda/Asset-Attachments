import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import healthRouter from "./health";
import axonhubRouter from "./axonhub";
import passthroughRouter from "./passthrough";
import geminiRouter from "./gemini";
import openrouterRouter, { handleOpenRouterModelList } from "./openrouter";
import { PROXY_API_KEY } from "../lib/proxy-key";
import { ApiError } from "../lib/api-error";
import { getRequestLogger } from "../lib/request-context";
import { anthropicModelList, anthropicModels } from "../lib/anthropic-request";

const router: IRouter = Router();
const geminiModels = [
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3-pro-image-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-image",
].map((name) => ({
  name: `models/${name}`,
  version: name,
  displayName: name,
  supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
}));
const geminiModelList = { models: geminiModels };
const geminiCompatibilityModelList = {
  models: geminiModels,
  data: geminiModels,
};

function isGeminiProxyRequest(req: Request): boolean {
  return `${req.baseUrl}${req.path}`.toLowerCase().includes("/gemini");
}

function proxyAuth(req: Request, res: Response, next: NextFunction) {
  const requestLogger = getRequestLogger(req);

  if (!PROXY_API_KEY) {
    next(new ApiError({
      status: 503,
      message: "Proxy API key not configured",
      type: "server_error",
      code: "proxy_api_key_not_configured",
      logLevel: "warn",
    }));
    return;
  }

  const auth = req.headers["authorization"];
  const xApiKey = req.headers["x-api-key"];
  const xGoogApiKey = req.headers["x-goog-api-key"];
  const geminiRoute = isGeminiProxyRequest(req);
  const bearerOk = typeof auth === "string" && auth === `Bearer ${PROXY_API_KEY}`;
  const xApiKeyOk = typeof xApiKey === "string" && xApiKey === PROXY_API_KEY;
  const xGoogApiKeyOk =
    geminiRoute
    && typeof xGoogApiKey === "string"
    && xGoogApiKey === PROXY_API_KEY;

  if (!bearerOk && !xApiKeyOk && !xGoogApiKeyOk) {
    const reason = !auth && !xApiKey && !xGoogApiKey
      ? "missing_auth_header"
      : auth && !bearerOk
        ? "invalid_bearer_token"
        : xApiKey
          ? "invalid_x_api_key"
          : "invalid_x_goog_api_key";

    next(new ApiError({
      status: 401,
      message: "Unauthorized - invalid or missing API key",
      type: "invalid_request_error",
      code: "unauthorized",
      details: {
        reason,
        hasAuthorization: !!auth,
        hasXApiKey: !!xApiKey,
        hasXGoogApiKey: !!xGoogApiKey,
        authScheme: auth ? auth.split(" ")[0] : undefined,
      },
      logLevel: "warn",
    }));
    return;
  }

  requestLogger.debug({
    url: req.url,
    method: req.method,
    via: bearerOk ? "bearer" : xApiKeyOk ? "x-api-key" : "x-goog-api-key",
  }, "Auth passed");
  next();
}

router.use(healthRouter);
router.use(axonhubRouter);

router.get("/anthropic/v1/models", (_req, res) => res.json(anthropicModelList));
router.get("/anthropic/models", (_req, res) => res.json(anthropicModelList));
router.get("/gemini/v1beta/models", (_req, res) => res.json(geminiModelList));
router.get("/gemini/v1/models", (_req, res) => res.json(geminiCompatibilityModelList));
router.get("/gemini/models", (_req, res) => res.json(geminiModels));
router.get("/openrouter/v1/models", async (request, response) => {
  await handleOpenRouterModelList(request, response);
});
router.get("/openrouter/models", async (request, response) => {
  await handleOpenRouterModelList(request, response);
});
router.use("/anthropic", proxyAuth, passthroughRouter);
router.use("/gemini", proxyAuth, geminiRouter);
router.use("/openrouter", proxyAuth, openrouterRouter);

export default router;
