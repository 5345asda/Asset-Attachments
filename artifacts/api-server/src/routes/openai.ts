import { Router, type Request, type Response } from "express";
import {
  OPENAI_SUPPORTED_MODELS,
} from "../lib/openai-models";
import { getOpenAIProviderConfig } from "../lib/openai-provider";
import { getProxyStreamConfig } from "../lib/proxy-stream";
import { getRequestLogger } from "../lib/request-context";
import { executeOpenAIRequest } from "../lib/providers/openai-execution";
import {
  sendExecutionResult,
  toProviderExecutionRequest,
} from "../lib/providers/http";

const router = Router();

export const openAIModelList = {
  data: OPENAI_SUPPORTED_MODELS.map((id) => ({
    id,
    object: "model",
    created: 1740000000,
    owned_by: "openai",
  })),
};

export async function handleOpenAIModelList(
  _request: Request,
  response: Response,
): Promise<void> {
  response.json(openAIModelList);
}

async function passthrough(
  request: Request,
  response: Response,
): Promise<void> {
  const result = await executeOpenAIRequest({
    request: toProviderExecutionRequest(request),
    provider: getOpenAIProviderConfig(),
    logger: getRequestLogger(request),
  });

  await sendExecutionResult(response, result, getProxyStreamConfig());
}

router.post("/v1/chat/completions", async (request, response) => {
  await passthrough(request, response);
});

router.post("/chat/completions", async (request, response) => {
  await passthrough(request, response);
});

router.post("/v1/responses", async (request, response) => {
  await passthrough(request, response);
});

router.post("/responses", async (request, response) => {
  await passthrough(request, response);
});

router.post("/v1/images/generations", async (request, response) => {
  await passthrough(request, response);
});

router.post("/images/generations", async (request, response) => {
  await passthrough(request, response);
});

export default router;
