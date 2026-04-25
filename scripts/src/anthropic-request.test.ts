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

test("sanitizeAnthropicBody raises max_tokens above thinking budget when the request is otherwise invalid", () => {
  const result = sanitizeAnthropicBody({
    model: "claude-opus-4-6",
    max_tokens: 500,
    thinking: {
      type: "enabled",
      budget_tokens: 2048,
    },
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      },
    ],
  });

  assert.equal(result.max_tokens, 2548);
  assert.deepEqual(result.thinking, {
    type: "enabled",
    budget_tokens: 2048,
  });
});

test("sanitizeAnthropicBody drops tool_result blocks without a matching tool_use in the previous assistant message", () => {
  const result = sanitizeAnthropicBody({
    model: "claude-sonnet-4-6",
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "让我帮你搜一下。",
          },
          {
            type: "tool_use",
            id: "toolu_valid",
            name: "mcp__tavily_search",
            input: {
              query: "中国经济 2025 最新情况",
            },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_invalid",
            content: "{\"year\":2026}",
          },
          {
            type: "tool_result",
            tool_use_id: "toolu_valid",
            content: "{\"error\":\"timeout\"}",
          },
        ],
      },
    ],
  }) as {
    messages?: Array<{
      role?: string;
      content?: Array<Record<string, unknown>>;
    }>;
  };

  assert.deepEqual(result.messages?.[1]?.content, [
    {
      type: "tool_result",
      tool_use_id: "toolu_valid",
      content: "{\"error\":\"timeout\"}",
    },
  ]);
});
