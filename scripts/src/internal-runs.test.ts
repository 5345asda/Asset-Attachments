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
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: raw ? JSON.parse(raw) : undefined,
        });
      });
    });

    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

function applyInternalRunsEnv() {
  process.env.INTERNAL_RUNS_TOKEN = "internal-runs-token";
  process.env.RUN_REDIS_URL = "redis://redis.local:6379/0";
  process.env.RUN_REDIS_USERNAME = "user";
  process.env.RUN_REDIS_PASSWORD = "password";
}

function clearInternalRunsEnv() {
  delete process.env.INTERNAL_RUNS_TOKEN;
  delete process.env.RUN_REDIS_URL;
  delete process.env.RUN_REDIS_USERNAME;
  delete process.env.RUN_REDIS_PASSWORD;
}

test("internal healthz exposes private executor status without leaking redis secrets", async (t) => {
  const previousEnv = {
    INTERNAL_RUNS_TOKEN: process.env.INTERNAL_RUNS_TOKEN,
    RUN_REDIS_URL: process.env.RUN_REDIS_URL,
    RUN_REDIS_USERNAME: process.env.RUN_REDIS_USERNAME,
    RUN_REDIS_PASSWORD: process.env.RUN_REDIS_PASSWORD,
  };

  applyInternalRunsEnv();
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

  const response = await fetch(`http://127.0.0.1:${server.port}/internal/healthz`);
  const body = await response.json() as {
    status?: string;
    mode?: string;
    internalRunsEnabled?: boolean;
    redis?: { configured?: boolean; connected?: boolean };
    workers?: { concurrency?: number; activeRuns?: number };
    providers?: Record<string, { configured?: boolean }>;
    token?: string;
  };

  assert.equal(response.status, 200);
  assert.equal(body.status, "ok");
  assert.equal(body.mode, "private_executor");
  assert.equal(body.internalRunsEnabled, true);
  assert.deepEqual(body.redis, { configured: true, connected: false });
  assert.equal(body.workers?.concurrency, 8);
  assert.equal(typeof body.workers?.activeRuns, "number");
  assert.equal(typeof body.providers?.openai?.configured, "boolean");
  assert.equal((body as Record<string, unknown>).token, undefined);

  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /redis:\/\/redis\.local:6379\/0/);
  assert.doesNotMatch(serialized, /password/);
  assert.doesNotMatch(serialized, /internal-runs-token/);
});

test("internal runs routes reject unauthenticated requests", async (t) => {
  const previousEnv = {
    INTERNAL_RUNS_TOKEN: process.env.INTERNAL_RUNS_TOKEN,
    RUN_REDIS_URL: process.env.RUN_REDIS_URL,
    RUN_REDIS_USERNAME: process.env.RUN_REDIS_USERNAME,
    RUN_REDIS_PASSWORD: process.env.RUN_REDIS_PASSWORD,
  };

  applyInternalRunsEnv();
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

  const response = await postJson(`http://127.0.0.1:${server.port}/internal/runs`, {
    body: {},
  });

  assert.equal(response.status, 401);
  assert.equal(response.body?.error?.message, "Unauthorized - invalid or missing internal token");
});

test("internal runs returns 503 quickly when Redis is configured but unavailable", async (t) => {
  const previousEnv = {
    INTERNAL_RUNS_TOKEN: process.env.INTERNAL_RUNS_TOKEN,
    RUN_REDIS_URL: process.env.RUN_REDIS_URL,
    RUN_REDIS_USERNAME: process.env.RUN_REDIS_USERNAME,
    RUN_REDIS_PASSWORD: process.env.RUN_REDIS_PASSWORD,
  };

  applyInternalRunsEnv();
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

  const response = await postJson(`http://127.0.0.1:${server.port}/internal/runs`, {
    headers: {
      authorization: "Bearer internal-runs-token",
    },
    body: {
      runId: "aa_run_accepted_1",
      provider: "openai",
      routePath: "/v1/chat/completions",
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: {
        model: "gpt-4.1",
        messages: [{ role: "user", content: "hello" }],
        stream: false,
      },
      stream: false,
      createdAt: "2026-05-14T12:00:00.000Z",
    },
  });

  assert.equal(response.status, 503);
  assert.deepEqual(response.body, {
    error: {
      message: "Internal runs Redis unavailable",
      type: "service_unavailable",
    },
  });
});

test("internal runs cancel returns 503 quickly when Redis is configured but unavailable", async (t) => {
  const previousEnv = {
    INTERNAL_RUNS_TOKEN: process.env.INTERNAL_RUNS_TOKEN,
    RUN_REDIS_URL: process.env.RUN_REDIS_URL,
    RUN_REDIS_USERNAME: process.env.RUN_REDIS_USERNAME,
    RUN_REDIS_PASSWORD: process.env.RUN_REDIS_PASSWORD,
  };

  applyInternalRunsEnv();
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

  const cancelled = await postJson(`http://127.0.0.1:${server.port}/internal/runs/aa_run_cancel_1/cancel`, {
    headers: {
      authorization: "Bearer internal-runs-token",
    },
    body: {
      reason: "client_disconnect",
    },
  });

  assert.equal(cancelled.status, 503);
  assert.deepEqual(cancelled.body, {
    error: {
      message: "Internal runs Redis unavailable",
      type: "service_unavailable",
    },
  });
});

test("internal runs rejects malformed envelopes with valid auth", async (t) => {
  const previousEnv = {
    INTERNAL_RUNS_TOKEN: process.env.INTERNAL_RUNS_TOKEN,
    RUN_REDIS_URL: process.env.RUN_REDIS_URL,
    RUN_REDIS_USERNAME: process.env.RUN_REDIS_USERNAME,
    RUN_REDIS_PASSWORD: process.env.RUN_REDIS_PASSWORD,
  };

  applyInternalRunsEnv();
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

  const response = await postJson(`http://127.0.0.1:${server.port}/internal/runs`, {
    headers: {
      authorization: "Bearer internal-runs-token",
    },
    body: {
      runId: "bad-envelope",
      provider: "openai",
    },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body?.error?.message, "Invalid internal run envelope");
});
