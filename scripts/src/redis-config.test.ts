import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const redisConfigModuleUrl = pathToFileURL(
  path.join(repoRoot, "artifacts", "api-server", "src", "lib", "redis-config.ts"),
).href;

type RedisConfigModule = {
  getRedisConfig: () => {
    configured: boolean;
    url: string;
    apiKey: string;
    source: "direct_secret" | "upstash_secret" | "none";
  };
};

type EnvSnapshot = {
  REDIS_URL: string | undefined;
  REDIS_KEY: string | undefined;
  REDIS_TOKEN: string | undefined;
  UPSTASH_REDIS_REST_URL: string | undefined;
  UPSTASH_REDIS_REST_TOKEN: string | undefined;
};

async function importFreshRedisConfigModule(cacheBuster: string): Promise<RedisConfigModule> {
  return await import(`${redisConfigModuleUrl}?redis-config-test=${cacheBuster}`) as RedisConfigModule;
}

function captureEnv(): EnvSnapshot {
  return {
    REDIS_URL: process.env.REDIS_URL,
    REDIS_KEY: process.env.REDIS_KEY,
    REDIS_TOKEN: process.env.REDIS_TOKEN,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
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

test("redis config reads direct REDIS_URL and REDIS_KEY from env", async (t) => {
  const envSnapshot = captureEnv();

  t.after(() => {
    restoreEnv(envSnapshot);
  });

  process.env.REDIS_URL = " https://redis.direct.test ";
  process.env.REDIS_KEY = " direct-redis-key ";
  delete process.env.REDIS_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;

  const redisConfigModule = await importFreshRedisConfigModule(`direct-${Date.now()}`);
  const redis = redisConfigModule.getRedisConfig();

  assert.deepEqual(redis, {
    configured: true,
    url: "https://redis.direct.test",
    apiKey: "direct-redis-key",
    source: "direct_secret",
  });
});

test("redis config falls back to Upstash REST env vars when generic vars are absent", async (t) => {
  const envSnapshot = captureEnv();

  t.after(() => {
    restoreEnv(envSnapshot);
  });

  delete process.env.REDIS_URL;
  delete process.env.REDIS_KEY;
  delete process.env.REDIS_TOKEN;
  process.env.UPSTASH_REDIS_REST_URL = " https://upstash.redis.test ";
  process.env.UPSTASH_REDIS_REST_TOKEN = " upstash-rest-token ";

  const redisConfigModule = await importFreshRedisConfigModule(`upstash-${Date.now()}`);
  const redis = redisConfigModule.getRedisConfig();

  assert.deepEqual(redis, {
    configured: true,
    url: "https://upstash.redis.test",
    apiKey: "upstash-rest-token",
    source: "upstash_secret",
  });
});

test("redis config accepts REDIS_TOKEN as an alias for REDIS_KEY", async (t) => {
  const envSnapshot = captureEnv();

  t.after(() => {
    restoreEnv(envSnapshot);
  });

  process.env.REDIS_URL = "https://redis.alias.test";
  delete process.env.REDIS_KEY;
  process.env.REDIS_TOKEN = "redis-token-alias";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;

  const redisConfigModule = await importFreshRedisConfigModule(`alias-${Date.now()}`);
  const redis = redisConfigModule.getRedisConfig();

  assert.deepEqual(redis, {
    configured: true,
    url: "https://redis.alias.test",
    apiKey: "redis-token-alias",
    source: "direct_secret",
  });
});

test("redis config keeps generic env vars ahead of vendor-specific fallbacks", async (t) => {
  const envSnapshot = captureEnv();

  t.after(() => {
    restoreEnv(envSnapshot);
  });

  process.env.REDIS_URL = "https://redis.primary.test";
  process.env.REDIS_KEY = "redis-primary-key";
  delete process.env.REDIS_TOKEN;
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.vendor.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "vendor-token";

  const redisConfigModule = await importFreshRedisConfigModule(`precedence-${Date.now()}`);
  const redis = redisConfigModule.getRedisConfig();

  assert.deepEqual(redis, {
    configured: true,
    url: "https://redis.primary.test",
    apiKey: "redis-primary-key",
    source: "direct_secret",
  });
});

test("redis config reports none when url or secret is missing", async (t) => {
  const envSnapshot = captureEnv();

  t.after(() => {
    restoreEnv(envSnapshot);
  });

  process.env.REDIS_URL = "https://redis.incomplete.test";
  delete process.env.REDIS_KEY;
  delete process.env.REDIS_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;

  const redisConfigModule = await importFreshRedisConfigModule(`none-${Date.now()}`);
  const redis = redisConfigModule.getRedisConfig();

  assert.deepEqual(redis, {
    configured: false,
    url: "",
    apiKey: "",
    source: "none",
  });
});

test("api-server startup logging includes redis configuration status", async () => {
  const indexSource = await readFile(
    path.join(repoRoot, "artifacts", "api-server", "src", "index.ts"),
    "utf8",
  );

  assert.match(indexSource, /getRedisConfig/);
  assert.match(indexSource, /redis:\s*redis\.configured/);
  assert.match(indexSource, /redis:\s*redis\.source/);
});
