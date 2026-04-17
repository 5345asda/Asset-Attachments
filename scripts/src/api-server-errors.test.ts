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

test("public anthropic model list routes bypass proxy auth", async (t) => {
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

  const v1Response = await fetch(`http://127.0.0.1:${server.port}/api/anthropic/v1/models`);
  const v1Body = await v1Response.json() as {
    data?: Array<{
      type?: string;
      id?: string;
      display_name?: string;
      created_at?: string;
    }>;
  };

  assert.equal(v1Response.status, 200);
  assert.ok(Array.isArray(v1Body.data));
  assert.ok(v1Body.data.length > 0);
  assert.deepEqual(v1Body.data[0], {
    type: "model",
    id: "claude-opus-4-7",
    display_name: "claude-opus-4-7",
    created_at: v1Body.data[0]?.created_at,
  });
  assert.match(v1Body.data[0]?.created_at ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(v1Response.headers.get("x-request-id"));

  const legacyResponse = await fetch(`http://127.0.0.1:${server.port}/api/anthropic/models`);
  const legacyBody = await legacyResponse.json() as typeof v1Body;

  assert.equal(legacyResponse.status, 200);
  assert.deepEqual(legacyBody, v1Body);
  assert.ok(legacyResponse.headers.get("x-request-id"));
});

test("public gemini model list route bypasses proxy auth and uses direct Gemini secrets", async (t) => {
  const previousEnv = {
    PROXY_API_KEY: process.env.PROXY_API_KEY,
    AI_INTEGRATIONS_GEMINI_BASE_URL: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
    AI_INTEGRATIONS_GEMINI_API_KEY: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
    GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };

  process.env.PROXY_API_KEY = "sk-proxy-test";
  delete process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  process.env.GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
  process.env.GEMINI_API_KEY = "gemini-direct-test-key";

  const originalFetch = globalThis.fetch;
  let lastRequestUrl = "";
  let lastRequestHeaders: unknown;

  globalThis.fetch = (async (input, init) => {
    lastRequestUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    lastRequestHeaders = init?.headers;

    return new Response(JSON.stringify({
      models: [
        {
          name: "models/gemini-2.5-flash",
          displayName: "Gemini 2.5 Flash",
        },
      ],
    }), {
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

  const response = await originalFetch(`http://127.0.0.1:${server.port}/api/gemini/v1beta/models`);
  const body = await response.json() as {
    models?: Array<{
      name?: string;
      displayName?: string;
    }>;
  };

  assert.equal(response.status, 200);
  assert.equal(lastRequestUrl, "https://generativelanguage.googleapis.com/v1beta/models");
  assert.equal(body.models?.[0]?.name, "models/gemini-2.5-flash");

  const headers = new Headers(lastRequestHeaders as Record<string, string>);
  assert.equal(headers.get("x-goog-api-key"), "gemini-direct-test-key");
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

test("non-gemini legacy provider passthrough routes are no longer supported", async (t) => {
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

test("gemini passthrough returns 503 when Gemini provider is not configured", async (t) => {
  const previousEnv = {
    PROXY_API_KEY: process.env.PROXY_API_KEY,
    AI_INTEGRATIONS_GEMINI_BASE_URL: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
    AI_INTEGRATIONS_GEMINI_API_KEY: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
    GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };

  process.env.PROXY_API_KEY = "sk-proxy-test";
  delete process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  delete process.env.GEMINI_BASE_URL;
  delete process.env.GEMINI_API_KEY;

  const server = await startAppServer();

  t.after(async () => {
    await server.close();

    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  const response = await postJson(`http://127.0.0.1:${server.port}/api/gemini/v1beta/models/gemini-2.5-flash:generateContent`, {
    headers: {
      authorization: "Bearer sk-proxy-test",
    },
    body: {
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
    },
  });

  assert.equal(response.status, 503);
  assert.deepEqual(response.body, {
    error: {
      message: "Gemini provider not configured",
      type: "service_unavailable",
    },
  });
  assert.ok(response.headers["x-request-id"]);
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

test("anthropic passthrough accepts direct Anthropic secrets without Replit integration", async (t) => {
  const previousEnv = {
    PROXY_API_KEY: process.env.PROXY_API_KEY,
    AI_INTEGRATIONS_ANTHROPIC_BASE_URL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    AI_INTEGRATIONS_ANTHROPIC_API_KEY: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  };

  process.env.PROXY_API_KEY = "sk-proxy-test";
  delete process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  delete process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_BASE_URL = "https://anthropic.byok.test";
  process.env.ANTHROPIC_API_KEY = "anthropic-direct-test-key";

  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  let lastRequestUrl = "";
  let lastRequestHeaders: unknown;

  globalThis.fetch = (async (input, init) => {
    fetchCalled = true;
    lastRequestUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    lastRequestHeaders = init?.headers;

    return new Response(JSON.stringify({ id: "msg_123", type: "message" }), {
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
      max_tokens: 64,
      messages: [{ role: "user", content: "hello" }],
    },
  });

  assert.equal(response.status, 200);
  if (!fetchCalled) {
    throw new Error("Expected passthrough fetch to be called.");
  }

  assert.equal(lastRequestUrl, "https://anthropic.byok.test/messages");
  const headers = new Headers(lastRequestHeaders as Record<string, string>);
  assert.equal(headers.get("x-api-key"), "anthropic-direct-test-key");
});

test("gemini passthrough accepts direct Gemini secrets and forwards native generateContent requests", async (t) => {
  const previousEnv = {
    PROXY_API_KEY: process.env.PROXY_API_KEY,
    AI_INTEGRATIONS_GEMINI_BASE_URL: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
    AI_INTEGRATIONS_GEMINI_API_KEY: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
    GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };

  process.env.PROXY_API_KEY = "sk-proxy-test";
  delete process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  process.env.GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
  process.env.GEMINI_API_KEY = "gemini-direct-test-key";

  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  let lastRequestUrl = "";
  let lastRequestHeaders: unknown;
  let lastRequestBody = "";

  globalThis.fetch = (async (input, init) => {
    fetchCalled = true;
    lastRequestUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    lastRequestHeaders = init?.headers;
    lastRequestBody = typeof init?.body === "string" ? init.body : "";

    return new Response(JSON.stringify({
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: "hello from gemini" }],
          },
          finishReason: "STOP",
        },
      ],
    }), {
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

  const requestBody = {
    contents: [{ role: "user", parts: [{ text: "hello" }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 128,
    },
  };

  const response = await postJson(`http://127.0.0.1:${server.port}/api/gemini/v1beta/models/gemini-2.5-flash:generateContent`, {
    headers: {
      authorization: "Bearer sk-proxy-test",
    },
    body: requestBody,
  });

  assert.equal(response.status, 200);
  if (!fetchCalled) {
    throw new Error("Expected Gemini passthrough fetch to be called.");
  }

  assert.equal(
    lastRequestUrl,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
  );
  assert.deepEqual(JSON.parse(lastRequestBody), requestBody);

  const headers = new Headers(lastRequestHeaders as Record<string, string>);
  assert.equal(headers.get("x-goog-api-key"), "gemini-direct-test-key");
  assert.equal(response.body.candidates?.[0]?.content?.parts?.[0]?.text, "hello from gemini");
});

test("gemini passthrough preserves native streamGenerateContent SSE responses", async (t) => {
  const previousEnv = {
    PROXY_API_KEY: process.env.PROXY_API_KEY,
    AI_INTEGRATIONS_GEMINI_BASE_URL: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
    AI_INTEGRATIONS_GEMINI_API_KEY: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
    GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };

  process.env.PROXY_API_KEY = "sk-proxy-test";
  delete process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  process.env.GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
  process.env.GEMINI_API_KEY = "gemini-direct-test-key";

  const originalFetch = globalThis.fetch;
  let lastRequestUrl = "";

  globalThis.fetch = (async (input) => {
    lastRequestUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    return new Response(
      "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"hello\"}]}}]}\n\n",
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

  const response = await originalFetch(`http://127.0.0.1:${server.port}/api/gemini/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer sk-proxy-test",
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert.equal(
    lastRequestUrl,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
  );
  assert.equal(
    await response.text(),
    "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"hello\"}]}}]}\n\n",
  );
});

test("anthropic passthrough adds task budget beta for opus 4.7 and drops obsolete effort beta", async (t) => {
  const previousEnv = {
    PROXY_API_KEY: process.env.PROXY_API_KEY,
    AI_INTEGRATIONS_ANTHROPIC_BASE_URL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    AI_INTEGRATIONS_ANTHROPIC_API_KEY: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  };

  process.env.PROXY_API_KEY = "sk-proxy-test";
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = "https://anthropic.example.test";
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "anthropic-test-key";

  const originalFetch = globalThis.fetch;
  let lastRequestHeaders: unknown;

  globalThis.fetch = (async (_input, init) => {
    lastRequestHeaders = init?.headers;

    return new Response(JSON.stringify({ id: "msg_123", type: "message" }), {
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
      "anthropic-beta": "effort-2025-11-24, interleaved-thinking-2025-05-14",
    },
    body: {
      model: "claude-opus-4-7",
      max_tokens: 64,
      output_config: {
        task_budget: {
          type: "tokens",
          total: 128000,
        },
      },
      messages: [{ role: "user", content: "hello" }],
    },
  });

  assert.equal(response.status, 200);

  const headers = new Headers(lastRequestHeaders as Record<string, string>);
  const betaValues = (headers.get("anthropic-beta") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();

  assert.deepEqual(betaValues, [
    "prompt-caching-2024-07-31",
    "task-budgets-2026-03-13",
  ]);
});
