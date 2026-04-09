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
