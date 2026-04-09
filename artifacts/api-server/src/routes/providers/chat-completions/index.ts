import { forwardAnthropicChatCompletion } from "./anthropic";
import { forwardGeminiChatCompletion } from "./gemini";
import { forwardOpenAiCompatibleChatCompletion } from "./openai";
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
