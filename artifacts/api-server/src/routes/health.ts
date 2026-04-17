import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { PROXY_API_KEY } from "../lib/proxy-key";
import { getAnthropicProviderConfig } from "../lib/anthropic-provider";
import { getGeminiProviderConfig } from "../lib/gemini-provider";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/proxy-info", (_req, res) => {
  const anthropic = getAnthropicProviderConfig();
  const gemini = getGeminiProviderConfig();

  res.json({
    proxyKey: PROXY_API_KEY,
    ready: anthropic.configured || gemini.configured,
    providers: ["anthropic", "gemini"],
    integrations: {
      anthropic: {
        configured: anthropic.configured,
      },
      gemini: {
        configured: gemini.configured,
      },
    },
  });
});

export default router;
