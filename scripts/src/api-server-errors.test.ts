import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

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

async function postJson(url: string, options: {
  headers?: Record<string, string>;
  body: unknown;
}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }> {
  const target = new URL(url);
  const payload = JSON.stringify(options.body);

  return await new Promise((resolve, reject) => {
    const request = http.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
        ...options.headers,
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: JSON.parse(raw),
          });
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

test("auth failures expose a request id in both header and body", async (t) => {
  const previousProxyKey = process.env.PROXY_API_KEY;
  process.env.PROXY_API_KEY = "sk-proxy-test";

  const server = await startAppServer();

  t.after(async () => {
    await server.close();

    if (previousProxyKey === undefined) {
      delete process.env.PROXY_API_KEY;
    } else {
      process.env.PROXY_API_KEY = previousProxyKey;
    }
  });

  const response = await fetch(`http://127.0.0.1:${server.port}/api/anthropic/v1/models`);
  const body = await response.json() as {
    error: {
      message?: string;
      type?: string;
    };
  };

  assert.equal(response.status, 401);
  assert.deepEqual(body, {
    error: {
      message: "Unauthorized - invalid or missing API key",
      type: "invalid_request_error",
    },
  });
  assert.ok(response.headers.get("x-request-id"));
});

test("legacy /api/v1 routes are no longer supported", async (t) => {
  const previousProxyKey = process.env.PROXY_API_KEY;
  process.env.PROXY_API_KEY = "sk-proxy-test";

  const server = await startAppServer();

  t.after(async () => {
    await server.close();

    if (previousProxyKey === undefined) {
      delete process.env.PROXY_API_KEY;
    } else {
      process.env.PROXY_API_KEY = previousProxyKey;
    }
  });

  const response = await fetch(`http://127.0.0.1:${server.port}/api/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer sk-proxy-test",
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: "hello" }],
    }),
  });
  assert.equal(response.status, 404);
});

test("non-anthropic provider passthrough routes are no longer supported", async (t) => {
  const previousProxyKey = process.env.PROXY_API_KEY;
  process.env.PROXY_API_KEY = "sk-proxy-test";

  const server = await startAppServer();

  t.after(async () => {
    await server.close();

    if (previousProxyKey === undefined) {
      delete process.env.PROXY_API_KEY;
    } else {
      process.env.PROXY_API_KEY = previousProxyKey;
    }
  });

  const response = await fetch(`http://127.0.0.1:${server.port}/api/openai/v1/chat/completions`, {
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

  assert.equal(response.status, 404);
});

test("anthropic assistant-prefill is rejected before any upstream call", async (t) => {
  const previousEnv = {
    PROXY_API_KEY: process.env.PROXY_API_KEY,
    AI_INTEGRATIONS_ANTHROPIC_BASE_URL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    AI_INTEGRATIONS_ANTHROPIC_API_KEY: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  };

  process.env.PROXY_API_KEY = "sk-proxy-test";
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = "https://anthropic.example.test";
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "anthropic-test-key";

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ ok: true }), {
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

  const response = await postJson(`http://127.0.0.1:${server.port}/api/anthropic/v1/messages`, {
    headers: {
      authorization: "Bearer sk-proxy-test",
      "anthropic-version": "2023-06-01",
    },
    body: {
      model: "claude-opus-4-6",
      messages: [
        { role: "user", content: "哥哥" },
        { role: "assistant", content: "继续" },
      ],
    },
  });
  const body = response.body as {
    error: {
      message?: string;
      type?: string;
    };
  };

  assert.equal(response.status, 400);
  assert.match(body.error.message ?? "", /final conversation turn to be a user message/i);
  assert.deepEqual(body, {
    error: {
      message: "Anthropic models require the final conversation turn to be a user message; assistant prefill is not supported.",
      type: "invalid_request_error",
    },
  });
  assert.equal(fetchCalls, 0);
  assert.ok(response.headers["x-request-id"]);
});
