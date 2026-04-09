import { Router, type Request, type Response } from "express";
import { ApiError } from "../lib/api-error";
import { getRequestLogger } from "../lib/request-context";
import {
  buildChatCompletionModelList,
  getChatCompletionForwarder,
  type ChatCompletionPayload,
  resolveChatCompletionRequest,
} from "./providers/chat-completions";

const router = Router();

router.get("/models", (_req: Request, res: Response) => {
  res.json(buildChatCompletionModelList());
});

router.post("/chat/completions", async (req: Request, res: Response) => {
  const payload = req.body as ChatCompletionPayload;
  const requestLogger = getRequestLogger(req);
  const { model, provider, url, key } = resolveChatCompletionRequest(payload);
  const forwarder = getChatCompletionForwarder(provider);

  requestLogger.info(
    {
      model,
      provider,
      stream: !!payload.stream,
      tools: Array.isArray(payload.tools) ? payload.tools.length : 0,
      temperature: payload.temperature,
      top_p: payload.top_p,
      max_tokens: payload.max_tokens,
      messages: Array.isArray(payload.messages) ? payload.messages.length : 0,
    },
    "Proxy request",
  );

  if (forwarder) {
    await forwarder({
      payload,
      provider,
      requestLogger,
      res,
      url,
      key,
    });
    return;
  }

  throw new ApiError({
    status: 400,
    message: `Unknown provider for model: ${model}`,
    type: "invalid_request_error",
    code: "unknown_provider",
    details: { model },
  });
});

export default router;
