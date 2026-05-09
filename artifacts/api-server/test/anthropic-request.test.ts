import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeAnthropicBody } from "../src/lib/anthropic-request.ts";

test("sanitizeAnthropicBody removes tools with blank names and drops tools when none remain", () => {
  const result = sanitizeAnthropicBody({
    model: "claude-opus-4-7",
    max_tokens: 32,
    messages: [{ role: "user", content: "Hi" }],
    tools: [
      {
        name: "",
        description: "invalid",
        input_schema: { type: "object", properties: {} },
      },
      {
        name: "   ",
        description: "also invalid",
        input_schema: { type: "object", properties: {} },
      },
    ],
  });

  assert.equal("tools" in result, false);
});

test("sanitizeAnthropicBody keeps only tools with valid Anthropic names", () => {
  const result = sanitizeAnthropicBody({
    model: "claude-opus-4-7",
    max_tokens: 32,
    messages: [{ role: "user", content: "Hi" }],
    tools: [
      {
        name: "",
        description: "invalid",
        input_schema: { type: "object", properties: {} },
      },
      {
        name: "bad name",
        description: "invalid because of spaces",
        input_schema: { type: "object", properties: {} },
      },
      {
        name: "extract_pdf_text",
        description: "valid",
        input_schema: { type: "object", properties: {} },
      },
    ],
  });

  assert.ok(Array.isArray(result.tools));
  assert.equal(result.tools.length, 1);
  assert.equal((result.tools[0] as { name: string }).name, "extract_pdf_text");
});
