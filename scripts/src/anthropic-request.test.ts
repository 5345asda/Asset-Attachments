import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeAnthropicBody } from "../../artifacts/api-server/src/lib/anthropic-request.ts";

test("sanitizeAnthropicBody removes temperature for claude-opus-4-7", () => {
  const result = sanitizeAnthropicBody({
    model: "claude-opus-4-7",
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
    ],
  });

  assert.equal("temperature" in result, false);
});

test("sanitizeAnthropicBody upgrades legacy opus 4.7 thinking and output_format fields", () => {
  const format = {
    type: "json_schema",
    name: "todo",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
      },
      required: ["title"],
    },
  };

  const result = sanitizeAnthropicBody({
    model: "claude-opus-4-7",
    thinking: {
      type: "enabled",
      budget_tokens: 32000,
      display: "summarized",
    },
    output_format: format,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
    ],
  }) as {
    thinking?: unknown;
    output_config?: unknown;
    output_format?: unknown;
  };

  assert.deepEqual(result.thinking, {
    type: "adaptive",
    display: "summarized",
  });
  assert.deepEqual(result.output_config, {
    effort: "high",
    format,
  });
  assert.equal("output_format" in result, false);
});

test("sanitizeAnthropicBody strips opus 4.7 sampling parameters that now hard-fail upstream", () => {
  const result = sanitizeAnthropicBody({
    model: "claude-opus-4-7",
    temperature: 0.2,
    top_p: 0.9,
    top_k: 50,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
    ],
  });

  assert.equal("temperature" in result, false);
  assert.equal("top_p" in result, false);
  assert.equal("top_k" in result, false);
});

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
