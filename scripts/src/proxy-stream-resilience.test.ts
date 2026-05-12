import assert from "node:assert/strict";
import test from "node:test";

import { pipeReaderToResponse } from "../../artifacts/api-server/src/lib/stream.ts";

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

function createDelayedReader(chunks: string[], delayMs: number) {
  let index = 0;

  return {
    async read(): Promise<{ done: boolean; value?: Uint8Array }> {
      if (index >= chunks.length) {
        return { done: true, value: undefined };
      }

      if (index === 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      const value = new TextEncoder().encode(chunks[index]);
      index += 1;
      return { done: false, value };
    },
    async cancel() {},
    releaseLock() {},
  };
}

async function startAppServer() {
  const { default: app } = await import("../../artifacts/api-server/src/app.ts");
  const server = app.listen(0);

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected an ephemeral TCP port for the test server.");
  }

  return {
    port: address.port,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

test("pipeReaderToResponse emits keepalive pings before the first upstream stream chunk when configured", async () => {
  const reader = createDelayedReader([
    "data: hello\n\n",
  ], 30);
  const response = createResponseCollector();

  await (pipeReaderToResponse as any)(reader, response, { keepaliveIntervalMs: 5 });

  const raw = response.writes.join("");
  assert.match(raw, /: ping\n\n/);
  assert.match(raw, /data: hello\n\n/);
  assert.ok(raw.indexOf(": ping\n\n") < raw.indexOf("data: hello\n\n"));
});

test("openai passthrough retries stream bootstrap failures before surfacing an error", async (t) => {
  const previousEnv = {
    PROXY_API_KEY: process.env.PROXY_API_KEY,
    AI_INTEGRATIONS_OPENAI_BASE_URL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    AI_INTEGRATIONS_OPENAI_API_KEY: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    PROXY_STREAM_BOOTSTRAP_RETRIES: process.env.PROXY_STREAM_BOOTSTRAP_RETRIES,
    PROXY_STREAM_KEEPALIVE_SECONDS: process.env.PROXY_STREAM_KEEPALIVE_SECONDS,
  };

  process.env.PROXY_API_KEY = "sk-proxy-test";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://openai.integration.test/v1";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "openai-integration-test-key";
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_API_KEY;
  process.env.PROXY_STREAM_BOOTSTRAP_RETRIES = "1";
  process.env.PROXY_STREAM_KEEPALIVE_SECONDS = "0";

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  globalThis.fetch = (async () => {
    fetchCalls += 1;

    if (fetchCalls === 1) {
      throw new Error("simulated bootstrap transport failure");
    }

    return new Response(
      "data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\n",
      {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      },
    );
  }) as typeof fetch;

  const server = await startAppServer();

  t.after(async () => {
    globalThis.fetch = originalFetch;
    await server.close();

    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  const response = await originalFetch(`http://127.0.0.1:${server.port}/api/openai/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer sk-proxy-test",
    },
    body: JSON.stringify({
      model: "gpt-5",
      stream: true,
      messages: [{ role: "user", content: "hello" }],
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(fetchCalls, 2);
  assert.equal(
    await response.text(),
    "data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\n",
  );
});

test("openai passthrough writes non-stream keepalive whitespace while waiting for upstream JSON", async (t) => {
  const previousEnv = {
    PROXY_API_KEY: process.env.PROXY_API_KEY,
    AI_INTEGRATIONS_OPENAI_BASE_URL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    AI_INTEGRATIONS_OPENAI_API_KEY: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    PROXY_NON_STREAM_KEEPALIVE_INTERVAL_SECONDS: process.env.PROXY_NON_STREAM_KEEPALIVE_INTERVAL_SECONDS,
  };

  process.env.PROXY_API_KEY = "sk-proxy-test";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://openai.integration.test/v1";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "openai-integration-test-key";
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_API_KEY;
  process.env.PROXY_NON_STREAM_KEEPALIVE_INTERVAL_SECONDS = "0.005";

  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(
            new TextEncoder().encode(JSON.stringify({
              id: "chatcmpl-openai",
              object: "chat.completion",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: "hello from openai",
                  },
                  finish_reason: "stop",
                },
              ],
            })),
          );
          controller.close();
        }, 30);
      },
    });

    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const server = await startAppServer();

  t.after(async () => {
    globalThis.fetch = originalFetch;
    await server.close();

    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  const response = await originalFetch(`http://127.0.0.1:${server.port}/api/openai/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer sk-proxy-test",
    },
    body: JSON.stringify({
      model: "gpt-5",
      messages: [{ role: "user", content: "hello" }],
    }),
  });

  const raw = await response.text();

  assert.equal(response.status, 200);
  assert.ok(raw.startsWith("\n"));
  assert.equal(JSON.parse(raw).id, "chatcmpl-openai");
});
