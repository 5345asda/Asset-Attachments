import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const internalRunConfigModuleUrl = pathToFileURL(
  path.join(repoRoot, "artifacts", "api-server", "src", "lib", "internal-run-config.ts"),
).href;

type InternalRunConfigModule = {
  getInternalRunsConfig: () => {
    tokenConfigured: boolean;
    internalRunsEnabled: boolean;
    token: string;
    workerConcurrency: number;
    eventBatchMs: number;
    eventBatchBytes: number;
    heartbeatIntervalMs: number;
    cancelPollMs: number;
    resultTtlSeconds: number;
    redis: {
      configured: boolean;
      url: string;
      username: string;
      password: string;
      keyPrefix: string;
      connectTimeoutMs: number;
      tlsCaPemB64: string;
      source: string;
    };
  };
};

type EnvSnapshot = {
  INTERNAL_RUNS_TOKEN: string | undefined;
  RUN_REDIS_URL: string | undefined;
  RUN_REDIS_USERNAME: string | undefined;
  RUN_REDIS_PASSWORD: string | undefined;
  RUN_REDIS_KEY_PREFIX: string | undefined;
  RUN_REDIS_CONNECT_TIMEOUT_MS: string | undefined;
  RUN_REDIS_TLS_CA_PEM_B64: string | undefined;
  RUN_WORKER_CONCURRENCY: string | undefined;
  RUN_EVENTS_BATCH_MS: string | undefined;
  RUN_EVENTS_BATCH_BYTES: string | undefined;
  RUN_HEARTBEAT_INTERVAL_MS: string | undefined;
  RUN_CANCEL_POLL_MS: string | undefined;
  RUN_RESULT_TTL_SECONDS: string | undefined;
};

async function importFreshInternalRunConfigModule(
  cacheBuster: string,
): Promise<InternalRunConfigModule> {
  return await import(
    `${internalRunConfigModuleUrl}?internal-run-config-test=${cacheBuster}`
  ) as InternalRunConfigModule;
}

function captureEnv(): EnvSnapshot {
  return {
    INTERNAL_RUNS_TOKEN: process.env.INTERNAL_RUNS_TOKEN,
    RUN_REDIS_URL: process.env.RUN_REDIS_URL,
    RUN_REDIS_USERNAME: process.env.RUN_REDIS_USERNAME,
    RUN_REDIS_PASSWORD: process.env.RUN_REDIS_PASSWORD,
    RUN_REDIS_KEY_PREFIX: process.env.RUN_REDIS_KEY_PREFIX,
    RUN_REDIS_CONNECT_TIMEOUT_MS: process.env.RUN_REDIS_CONNECT_TIMEOUT_MS,
    RUN_REDIS_TLS_CA_PEM_B64: process.env.RUN_REDIS_TLS_CA_PEM_B64,
    RUN_WORKER_CONCURRENCY: process.env.RUN_WORKER_CONCURRENCY,
    RUN_EVENTS_BATCH_MS: process.env.RUN_EVENTS_BATCH_MS,
    RUN_EVENTS_BATCH_BYTES: process.env.RUN_EVENTS_BATCH_BYTES,
    RUN_HEARTBEAT_INTERVAL_MS: process.env.RUN_HEARTBEAT_INTERVAL_MS,
    RUN_CANCEL_POLL_MS: process.env.RUN_CANCEL_POLL_MS,
    RUN_RESULT_TTL_SECONDS: process.env.RUN_RESULT_TTL_SECONDS,
  };
}

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
}

test("internal runs config reads token, redis, and worker env from the session contract names", async (t) => {
  const envSnapshot = captureEnv();

  t.after(() => {
    restoreEnv(envSnapshot);
  });

  process.env.INTERNAL_RUNS_TOKEN = " internal-runs-token ";
  process.env.RUN_REDIS_URL = " rediss://redis-aa.example.test:6380/0 ";
  process.env.RUN_REDIS_USERNAME = " aa_replit ";
  process.env.RUN_REDIS_PASSWORD = " redis-password ";
  process.env.RUN_REDIS_KEY_PREFIX = " aa ";
  process.env.RUN_REDIS_CONNECT_TIMEOUT_MS = "7000";
  process.env.RUN_REDIS_TLS_CA_PEM_B64 = "ZmFrZS1jYQ==";
  process.env.RUN_WORKER_CONCURRENCY = "12";
  process.env.RUN_EVENTS_BATCH_MS = "75";
  process.env.RUN_EVENTS_BATCH_BYTES = "4096";
  process.env.RUN_HEARTBEAT_INTERVAL_MS = "8000";
  process.env.RUN_CANCEL_POLL_MS = "1500";
  process.env.RUN_RESULT_TTL_SECONDS = "7200";

  const internalRunConfigModule = await importFreshInternalRunConfigModule(`full-${Date.now()}`);
  const config = internalRunConfigModule.getInternalRunsConfig();

  assert.equal(config.tokenConfigured, true);
  assert.equal(config.internalRunsEnabled, true);
  assert.equal(config.token, "internal-runs-token");
  assert.equal(config.workerConcurrency, 12);
  assert.equal(config.eventBatchMs, 75);
  assert.equal(config.eventBatchBytes, 4096);
  assert.equal(config.heartbeatIntervalMs, 8000);
  assert.equal(config.cancelPollMs, 1500);
  assert.equal(config.resultTtlSeconds, 7200);
  assert.deepEqual(config.redis, {
    configured: true,
    url: "rediss://redis-aa.example.test:6380/0",
    username: "aa_replit",
    password: "redis-password",
    keyPrefix: "aa",
    connectTimeoutMs: 7000,
    tlsCaPemB64: "ZmFrZS1jYQ==",
    source: "run_env",
  });
});

test("internal runs config does not invent default token or redis secrets", async (t) => {
  const envSnapshot = captureEnv();

  t.after(() => {
    restoreEnv(envSnapshot);
  });

  delete process.env.INTERNAL_RUNS_TOKEN;
  delete process.env.RUN_REDIS_URL;
  delete process.env.RUN_REDIS_USERNAME;
  delete process.env.RUN_REDIS_PASSWORD;
  delete process.env.RUN_REDIS_KEY_PREFIX;
  delete process.env.RUN_REDIS_CONNECT_TIMEOUT_MS;
  delete process.env.RUN_REDIS_TLS_CA_PEM_B64;
  delete process.env.RUN_WORKER_CONCURRENCY;
  delete process.env.RUN_EVENTS_BATCH_MS;
  delete process.env.RUN_EVENTS_BATCH_BYTES;
  delete process.env.RUN_HEARTBEAT_INTERVAL_MS;
  delete process.env.RUN_CANCEL_POLL_MS;
  delete process.env.RUN_RESULT_TTL_SECONDS;

  const internalRunConfigModule = await importFreshInternalRunConfigModule(`defaults-${Date.now()}`);
  const config = internalRunConfigModule.getInternalRunsConfig();

  assert.equal(config.tokenConfigured, false);
  assert.equal(config.internalRunsEnabled, false);
  assert.equal(config.token, "");
  assert.equal(config.redis.configured, false);
  assert.equal(config.redis.url, "");
  assert.equal(config.redis.username, "");
  assert.equal(config.redis.password, "");
});

test("internal runs config keeps sane defaults for non-secret tuning knobs", async (t) => {
  const envSnapshot = captureEnv();

  t.after(() => {
    restoreEnv(envSnapshot);
  });

  process.env.INTERNAL_RUNS_TOKEN = "token";
  process.env.RUN_REDIS_URL = "redis://redis.local:6379/0";
  process.env.RUN_REDIS_USERNAME = "user";
  process.env.RUN_REDIS_PASSWORD = "password";
  delete process.env.RUN_REDIS_KEY_PREFIX;
  delete process.env.RUN_REDIS_CONNECT_TIMEOUT_MS;
  delete process.env.RUN_REDIS_TLS_CA_PEM_B64;
  delete process.env.RUN_WORKER_CONCURRENCY;
  delete process.env.RUN_EVENTS_BATCH_MS;
  delete process.env.RUN_EVENTS_BATCH_BYTES;
  delete process.env.RUN_HEARTBEAT_INTERVAL_MS;
  delete process.env.RUN_CANCEL_POLL_MS;
  delete process.env.RUN_RESULT_TTL_SECONDS;

  const internalRunConfigModule = await importFreshInternalRunConfigModule(`tunables-${Date.now()}`);
  const config = internalRunConfigModule.getInternalRunsConfig();

  assert.equal(config.internalRunsEnabled, true);
  assert.equal(config.redis.keyPrefix, "aa");
  assert.equal(config.redis.connectTimeoutMs, 5000);
  assert.equal(config.redis.tlsCaPemB64, "");
  assert.equal(config.workerConcurrency, 8);
  assert.equal(config.eventBatchMs, 50);
  assert.equal(config.eventBatchBytes, 2048);
  assert.equal(config.heartbeatIntervalMs, 5000);
  assert.equal(config.cancelPollMs, 1000);
  assert.equal(config.resultTtlSeconds, 3600);
});
