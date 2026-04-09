import {
  geminiToOaiResponse,
  oaiMessagesToGemini,
  streamGemini,
} from "../../../lib/format/gemini";
import { readJsonOrText } from "./common";
import type { ChatCompletionForwarder } from "./types";

export const forwardGeminiChatCompletion: ChatCompletionForwarder = async ({
  payload,
  url,
  key,
  requestLogger,
  res,
}) => {
  const systemMessage = (payload.messages || []).find(
    (message: any) => message.role === "system",
  );
  const body: Record<string, unknown> = {
    contents: oaiMessagesToGemini(payload.messages || []),
    ...(systemMessage
      ? {
          systemInstruction: { parts: [{ text: systemMessage.content }] },
        }
      : {}),
    generationConfig: {
      ...(payload.temperature !== undefined ? { temperature: payload.temperature } : {}),
      ...(payload.max_tokens ? { maxOutputTokens: payload.max_tokens } : {}),
    },
  };

  const endpoint = payload.stream ? "streamGenerateContent" : "generateContent";
  const upstream = await fetch(
    `${url}/models/${payload.model}:${endpoint}${payload.stream ? "?alt=sse" : ""}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    },
  );

  if (!upstream.ok) {
    const upstreamError = await readJsonOrText(upstream);
    requestLogger.warn(
      { status: upstream.status, model: payload.model, upstreamError },
      "Gemini upstream error",
    );
    res.status(upstream.status).json(upstreamError);
    return;
  }

  if (payload.stream) {
    await streamGemini(
      upstream.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>,
      res,
      payload.model,
    );
    return;
  }

  res.json(geminiToOaiResponse(await upstream.json() as any, payload.model));
};
