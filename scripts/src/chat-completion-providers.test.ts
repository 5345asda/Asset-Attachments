import assert from "node:assert/strict";
import test from "node:test";

test("chat completion forwarders are resolved through a provider registry", async () => {
  const registryModule = await import(
    "../../artifacts/api-server/src/routes/providers/chat-completions/index.ts"
  ) as {
    getChatCompletionForwarder(provider: string): unknown;
  };

  assert.equal(typeof registryModule.getChatCompletionForwarder("openai"), "function");
  assert.equal(typeof registryModule.getChatCompletionForwarder("openrouter"), "function");
  assert.equal(typeof registryModule.getChatCompletionForwarder("anthropic"), "function");
  assert.equal(typeof registryModule.getChatCompletionForwarder("gemini"), "function");
  assert.equal(registryModule.getChatCompletionForwarder("unknown"), null);
});

test("chat completion model catalog is exposed from a dedicated module", async () => {
  const catalogModule = await import(
    "../../artifacts/api-server/src/routes/providers/chat-completions/catalog.ts"
  ) as {
    CHAT_COMPLETION_MODELS: Array<{ id: string; owned_by: string }>;
    buildChatCompletionModelList(): { object: string; data: Array<{ id: string; object: string }> };
  };

  assert.ok(catalogModule.CHAT_COMPLETION_MODELS.length > 0);
  assert.ok(catalogModule.CHAT_COMPLETION_MODELS.some((model) => model.id === "claude-opus-4-6"));
  assert.equal(catalogModule.buildChatCompletionModelList().object, "list");
});

test("chat completion request resolution is exposed from a dedicated module", async () => {
  const previousOpenAiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const previousOpenAiApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://openai.example.test";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "openai-test-key";

  try {
    const requestModule = await import(
      "../../artifacts/api-server/src/routes/providers/chat-completions/request.ts"
    ) as {
      resolveChatCompletionRequest(payload: Record<string, unknown>): {
        model: string;
        provider: string;
        url: string;
        key: string;
      };
    };

    const resolved = requestModule.resolveChatCompletionRequest({
      model: "gpt-5",
    });

    assert.deepEqual(resolved, {
      model: "gpt-5",
      provider: "openai",
      url: "https://openai.example.test",
      key: "openai-test-key",
    });
  } finally {
    if (previousOpenAiBaseUrl === undefined) {
      delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    } else {
      process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = previousOpenAiBaseUrl;
    }

    if (previousOpenAiApiKey === undefined) {
      delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    } else {
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY = previousOpenAiApiKey;
    }
  }
});
