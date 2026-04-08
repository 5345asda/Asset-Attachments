import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { PROXY_API_KEY } from "../lib/proxy-key";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/proxy-info", (_req, res) => {
  res.json({
    proxyKey: PROXY_API_KEY,
    providers: ["anthropic", "openai", "gemini"],
  });
});

export default router;
