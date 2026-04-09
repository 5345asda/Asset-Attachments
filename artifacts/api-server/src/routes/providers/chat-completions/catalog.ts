export const CHAT_COMPLETION_MODELS = [
  { id: "claude-opus-4-6", owned_by: "anthropic" },
  { id: "claude-opus-4-5", owned_by: "anthropic" },
  { id: "claude-opus-4-1", owned_by: "anthropic" },
  { id: "claude-sonnet-4-6", owned_by: "anthropic" },
  { id: "claude-sonnet-4-5", owned_by: "anthropic" },
  { id: "claude-haiku-4-5", owned_by: "anthropic" },
  { id: "gpt-5.2", owned_by: "openai" },
  { id: "gpt-5.1", owned_by: "openai" },
  { id: "gpt-5", owned_by: "openai" },
  { id: "gpt-5-mini", owned_by: "openai" },
  { id: "gpt-5-nano", owned_by: "openai" },
  { id: "gpt-4.1", owned_by: "openai" },
  { id: "gpt-4.1-mini", owned_by: "openai" },
  { id: "gpt-4.1-nano", owned_by: "openai" },
  { id: "gpt-4o", owned_by: "openai" },
  { id: "gpt-4o-mini", owned_by: "openai" },
  { id: "o4-mini", owned_by: "openai" },
  { id: "o3", owned_by: "openai" },
  { id: "o3-mini", owned_by: "openai" },
  { id: "gemini-2.5-pro", owned_by: "google" },
  { id: "gemini-2.5-flash", owned_by: "google" },
];

export function buildChatCompletionModelList() {
  return {
    object: "list",
    data: CHAT_COMPLETION_MODELS.map((model) => ({
      ...model,
      object: "model",
      created: 1700000000,
    })),
  };
}
