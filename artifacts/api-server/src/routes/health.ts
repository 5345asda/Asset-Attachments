import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { PROXY_API_KEY } from "../lib/proxy-key";
import { getAnthropicProviderConfig } from "../lib/anthropic-provider";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/proxy-info", (_req, res) => {
  const anthropic = getAnthropicProviderConfig();

  res.json({
    proxyKey: PROXY_API_KEY,
    ready: anthropic.configured,
    providers: ["anthropic"],
    integrations: {
      anthropic: {
        configured: anthropic.configured,
      },
    },
  });
});

export default router;
