import { pipeReaderToResponse } from "../../../lib/stream";
import { readJsonOrText } from "./common";
import type { ChatCompletionForwarder } from "./types";

export const forwardOpenAiCompatibleChatCompletion: ChatCompletionForwarder = async ({
  payload,
  url,
  key,
  provider,
  requestLogger,
  res,
}) => {
  const upstream = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(payload),
  });

  if (payload.stream) {
    res.writeHead(upstream.status, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    await pipeReaderToResponse(
      upstream.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>,
      res,
    );
    return;
  }

  const body = await readJsonOrText(upstream);
  if (!upstream.ok) {
    requestLogger.warn(
      {
        status: upstream.status,
        model: payload.model,
        provider,
        upstreamError: body,
      },
      `${provider} upstream error`,
    );
  }

  res.status(upstream.status).json(body);
};
