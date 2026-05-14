import { Router, type Request, type Response } from "express";
import { getGeminiProviderConfig } from "../lib/gemini-provider";
import { getProxyStreamConfig } from "../lib/proxy-stream";
import { getRequestLogger } from "../lib/request-context";
import { executeGeminiRequest } from "../lib/providers/gemini-execution";
import {
  sendExecutionResult,
  toProviderExecutionRequest,
} from "../lib/providers/http";

const router = Router();

async function passthrough(
  request: Request,
  response: Response,
): Promise<void> {
  const result = await executeGeminiRequest({
    request: toProviderExecutionRequest(request),
    provider: getGeminiProviderConfig(),
    logger: getRequestLogger(request),
  });

  await sendExecutionResult(response, result, getProxyStreamConfig());
}

router.use("/", async (request, response) => {
  await passthrough(request, response);
});

export default router;
