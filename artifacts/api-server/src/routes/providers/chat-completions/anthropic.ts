import {
  anthropicToOaiResponse,
  oaiMessagesToAnthropic,
  oaiToolChoiceToAnthropic,
  oaiToolsToAnthropic,
  streamAnthropic,
} from "../../../lib/format/anthropic";
import { validateAnthropicMessages } from "../../../lib/anthropic-request";
import { readJsonOrText } from "./common";
import type { ChatCompletionForwarder } from "./types";

export const forwardAnthropicChatCompletion: ChatCompletionForwarder = async ({
  payload,
  url,
  key,
  requestLogger,
  res,
}) => {
  validateAnthropicMessages(payload.messages);

  const systemMessage = (payload.messages || []).find(
    (message: any) => message.role === "system",
  );
  const hasTemperature = payload.temperature !== undefined;
  const hasTopP = payload.top_p !== undefined;

  if (hasTemperature && hasTopP) {
    requestLogger.warn(
      { temperature: payload.temperature, top_p: payload.top_p, model: payload.model },
      "Anthropic: removed top_p — cannot specify both temperature and top_p; keeping temperature",
    );
  }

  const convertedMessages = oaiMessagesToAnthropic(payload.messages || []);
  if (convertedMessages.length > 1) {
    const target = convertedMessages[convertedMessages.length - 2];
    if (Array.isArray(target.content) && target.content.length > 0) {
      const lastBlock = target.content[target.content.length - 1];
      target.content[target.content.length - 1] = {
        ...lastBlock,
        cache_control: { type: "ephemeral", ttl: "1h" },
      };
    } else if (typeof target.content === "string") {
      convertedMessages[convertedMessages.length - 2] = {
        ...target,
        content: [{
          type: "text",
          text: target.content,
          cache_control: { type: "ephemeral", ttl: "1h" },
        }],
      };
    }
  }

  const systemText = systemMessage
    ? (typeof systemMessage.content === "string"
      ? systemMessage.content
      : JSON.stringify(systemMessage.content))
    : null;

  const body: Record<string, unknown> = {
    model: payload.model,
    max_tokens: payload.max_tokens || 8192,
    messages: convertedMessages,
    ...(systemText
      ? {
          system: [{
            type: "text",
            text: systemText,
            cache_control: { type: "ephemeral", ttl: "1h" },
          }],
        }
      : {}),
    ...(payload.stream ? { stream: true } : {}),
    ...(hasTemperature ? { temperature: payload.temperature } : {}),
    ...(!hasTemperature && hasTopP ? { top_p: payload.top_p } : {}),
    ...(payload.stop
      ? {
          stop_sequences: Array.isArray(payload.stop) ? payload.stop : [payload.stop],
        }
      : {}),
  };

  if (Array.isArray(payload.tools) && payload.tools.length > 0) {
    const convertedTools = oaiToolsToAnthropic(payload.tools);
    convertedTools[convertedTools.length - 1] = {
      ...convertedTools[convertedTools.length - 1],
      cache_control: { type: "ephemeral", ttl: "1h" },
    };
    body.tools = convertedTools;
    const toolChoice = oaiToolChoiceToAnthropic(payload.tool_choice);
    if (toolChoice) {
      body.tool_choice = toolChoice;
    }
  }

  const upstream = await fetch(`${url}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!upstream.ok) {
    const upstreamError = await readJsonOrText(upstream);
    requestLogger.warn(
      { status: upstream.status, model: payload.model, upstreamError },
      "Anthropic upstream error",
    );
    res.status(upstream.status).json(upstreamError);
    return;
  }

  if (payload.stream) {
    await streamAnthropic(
      upstream.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>,
      res,
      payload.model,
    );
    return;
  }

  res.json(anthropicToOaiResponse(await upstream.json() as any, payload.model));
};
