import assert from "node:assert/strict";
import test from "node:test";

import { pipeAnthropicStreamWithUsageAdjust } from "../../artifacts/api-server/src/lib/stream.ts";

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

function extractUsageEvents(rawOutput: string): Array<{ type?: string; usage?: Record<string, number> }> {
  return rawOutput
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6).trim())
    .filter((line) => line && line !== "[DONE]")
    .map((line) => JSON.parse(line))
    .map((event) => ({
      type: event.type,
      usage: event.message?.usage ?? event.usage,
    }))
    .filter((event) => event.usage);
}

test("pipeAnthropicStreamWithUsageAdjust keeps cache_read_input_tokens cleared after merging into cache_creation_input_tokens", async () => {
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

    await pipeAnthropicStreamWithUsageAdjust(reader as any, response as any);

    const usageEvents = extractUsageEvents(response.writes.join(""));

    assert.equal(usageEvents.length, 3);
    assert.deepEqual(usageEvents[0], {
      type: "message_start",
      usage: {
        input_tokens: 100,
        output_tokens: 0,
        cache_creation_input_tokens: 50,
      },
    });
    assert.deepEqual(usageEvents[1], {
      type: "message_delta",
      usage: {
        output_tokens: 20,
      },
    });
    assert.deepEqual(usageEvents[2], {
      type: "message_delta",
      usage: {
        output_tokens: 30,
      },
    });
  } finally {
    Math.random = originalRandom;
  }
});
