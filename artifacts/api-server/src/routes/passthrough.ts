import { Router, type Request, type Response } from "express";
import { anthropicModelList } from "../lib/anthropic-request";
import { getAnthropicProviderConfig } from "../lib/anthropic-provider";
import { getProxyStreamConfig } from "../lib/proxy-stream";
import { getRequestLogger } from "../lib/request-context";
import { executeAnthropicRequest } from "../lib/providers/anthropic-execution";
import {
  sendExecutionResult,
  toProviderExecutionRequest,
} from "../lib/providers/http";

const router = Router();

async function passthrough(
  request: Request,
  response: Response,
): Promise<void> {
  const result = await executeAnthropicRequest({
    request: toProviderExecutionRequest(request),
    provider: getAnthropicProviderConfig(),
    logger: getRequestLogger(request),
  });

  await sendExecutionResult(response, result, getProxyStreamConfig());
}

router.get("/v1/models", (_req, res) => res.json(anthropicModelList));
router.get("/models", (_req, res) => res.json(anthropicModelList));
router.use("/", async (request, response) => {
  await passthrough(request, response);
});

export default router;
