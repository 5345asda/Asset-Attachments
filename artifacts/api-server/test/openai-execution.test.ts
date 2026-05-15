import test from "node:test";
import assert from "node:assert/strict";

import type { OpenAIProviderConfig } from "../src/lib/openai-provider.ts";
import { executeOpenAIRequest } from "../src/lib/providers/openai-execution.ts";
import { createSilentLogger } from "./helpers.ts";

test("executeOpenAIRequest normalizes chat completion tokens before forwarding and preserves upstream usage verbatim", async () => {
  const requests: Array<{
    input: RequestInfo | URL;
    init?: RequestInit;
  }> = [];

  const provider: OpenAIProviderConfig = {
    configured: true,
    baseUrl: "https://example.test/v1",
    apiKey: "sk-upstream",
    source: "direct_secret",
  };

  const result = await executeOpenAIRequest({
    request: {
      method: "POST",
      path: "/v1/chat/completions",
      url: "/v1/chat/completions",
      headers: {
        "content-type": "application/json",
      },
      body: {
        model: "gpt-5",
        stream: false,
        max_tokens: 321,
        messages: [
          {
            role: "user",
            content: "hello",
          },
        ],
      },
    },
    provider,
    logger: createSilentLogger(),
    fetchImpl: async (input, init) => {
      requests.push({ input, init });

      return new Response(JSON.stringify({
        id: "chatcmpl_test",
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 999,
          reasoning_tokens: 7,
        },
        choices: [],
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(String(requests[0]?.input), "https://example.test/v1/chat/completions");

  const forwardedBody = JSON.parse(String(requests[0]?.init?.body)) as Record<string, unknown>;
  assert.equal(forwardedBody.max_tokens, undefined);
  assert.equal(forwardedBody.max_completion_tokens, 321);

  assert.equal(result.status, 200);
  assert.equal(result.stream, false);
  assert.equal(result.contentType, "application/json");

  const payload = JSON.parse(Buffer.from(await result.readBody()).toString("utf8")) as Record<string, unknown>;
  assert.deepEqual(payload.usage, {
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 999,
    reasoning_tokens: 7,
  });
});
