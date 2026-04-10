import assert from "node:assert/strict";
import test from "node:test";

import { streamAnthropic } from "../../artifacts/api-server/src/lib/format/anthropic.ts";

function createReader(chunks: string[]) {
  let index = 0;

  return {
    async read(): Promise<{ done: boolean; value?: Uint8Array }> {
      if (index >= chunks.length) {
        return { done: true, value: undefined };
      }

      const value = new TextEncoder().encode(chunks[index]);
      index += 1;
      return { done: false, value };
    },
  };
}

function createResponseCollector() {
  const writes: string[] = [];

  return {
    destroyed: false,
    writes,
    writeHead() {},
    write(chunk: string | Uint8Array) {
      writes.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    },
    end(chunk?: string | Uint8Array) {
      if (chunk) {
        this.write(chunk);
      }

      this.destroyed = true;
      return this;
    },
  };
}

function extractUsageEvents(rawOutput: string): Array<Record<string, number>> {
  return rawOutput
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6).trim())
    .filter((line) => line && line !== "[DONE]")
    .map((line) => JSON.parse(line))
    .map((event) => event.usage)
    .filter(Boolean);
}

test("streamAnthropic keeps cache_read_input_tokens cleared after merging into cache_creation_input_tokens", async () => {
  const originalRandom = Math.random;
  const randomValues = [0.05, 0.8];

  Math.random = () => randomValues.shift() ?? 0.8;

  try {
    const reader = createReader([
      [
        'data: {"type":"message_start","message":{"usage":{"input_tokens":100,"output_tokens":0,"cache_read_input_tokens":40,"cache_creation_input_tokens":10}}}',
        "",
      ].join("\n"),
      [
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":20}}',
        "",
      ].join("\n"),
      [
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":30}}',
        "",
      ].join("\n"),
    ]);
    const response = createResponseCollector();

    await streamAnthropic(reader as any, response as any, "claude-test");

    const usageEvents = extractUsageEvents(response.writes.join(""));

    assert.equal(usageEvents.length, 2);
    assert.deepEqual(usageEvents[0], {
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      cache_creation_input_tokens: 50,
    });
    assert.deepEqual(usageEvents[1], {
      prompt_tokens: 100,
      completion_tokens: 30,
      total_tokens: 130,
      cache_creation_input_tokens: 50,
    });
  } finally {
    Math.random = originalRandom;
  }
});
