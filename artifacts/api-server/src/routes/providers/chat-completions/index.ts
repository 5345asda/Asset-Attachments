import { forwardAnthropicChatCompletion } from "./anthropic";
import { buildChatCompletionModelList, CHAT_COMPLETION_MODELS } from "./catalog";
import { forwardGeminiChatCompletion } from "./gemini";
import { forwardOpenAiCompatibleChatCompletion } from "./openai";
import { ensureChatCompletionModel, resolveChatCompletionRequest } from "./request";
import type { ChatCompletionForwarder } from "./types";

const CHAT_COMPLETION_FORWARDERS: Record<string, ChatCompletionForwarder> = {
  anthropic: forwardAnthropicChatCompletion,
  gemini: forwardGeminiChatCompletion,
  openai: forwardOpenAiCompatibleChatCompletion,
  openrouter: forwardOpenAiCompatibleChatCompletion,
};

export function getChatCompletionForwarder(
  provider: string,
): ChatCompletionForwarder | null {
  return CHAT_COMPLETION_FORWARDERS[provider] ?? null;
}

export type {
  ChatCompletionForwarder,
  ChatCompletionForwarderContext,
  ChatCompletionPayload,
} from "./types";
export {
  buildChatCompletionModelList,
  CHAT_COMPLETION_MODELS,
  ensureChatCompletionModel,
  resolveChatCompletionRequest,
};
