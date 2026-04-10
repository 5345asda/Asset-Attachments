import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeAnthropicBody } from "../../artifacts/api-server/src/lib/anthropic-request.ts";

test("sanitizeAnthropicBody normalizes temperature to 1 when thinking is enabled", () => {
  const result = sanitizeAnthropicBody({
    model: "claude-sonnet-4-6",
    temperature: 0.2,
    thinking: {
      type: "enabled",
      budget_tokens: 1024,
    },
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
    ],
  });

  assert.equal(result.temperature, 1);
  assert.deepEqual(result.thinking, {
    type: "enabled",
    budget_tokens: 1024,
  });
});
