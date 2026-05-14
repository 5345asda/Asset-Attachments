export type InternalRunRedisConfig = {
  configured: boolean;
  url: string;
  username: string;
  password: string;
  keyPrefix: string;
  connectTimeoutMs: number;
  tlsCaPemB64: string;
  source: "run_env" | "none";
};

export type InternalRunsConfig = {
  tokenConfigured: boolean;
  internalRunsEnabled: boolean;
  token: string;
  workerConcurrency: number;
  eventBatchMs: number;
  eventBatchBytes: number;
  heartbeatIntervalMs: number;
  cancelPollMs: number;
  resultTtlSeconds: number;
  redis: InternalRunRedisConfig;
};

function readEnv(name: string): string {
  return process.env[name]?.trim() || "";
}

function readPositiveInt(name: string, fallback: number): number {
  const rawValue = readEnv(name);
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getInternalRunsConfig(): InternalRunsConfig {
  const token = readEnv("INTERNAL_RUNS_TOKEN");
  const url = readEnv("RUN_REDIS_URL");
  const username = readEnv("RUN_REDIS_USERNAME");
  const password = readEnv("RUN_REDIS_PASSWORD");
  const redisConfigured = Boolean(url && password);
  const redis: InternalRunRedisConfig = {
    configured: redisConfigured,
    url: redisConfigured ? url : "",
    username: redisConfigured ? username : "",
    password: redisConfigured ? password : "",
    keyPrefix: readEnv("RUN_REDIS_KEY_PREFIX") || "aa",
    connectTimeoutMs: readPositiveInt("RUN_REDIS_CONNECT_TIMEOUT_MS", 5000),
    tlsCaPemB64: readEnv("RUN_REDIS_TLS_CA_PEM_B64"),
    source: redisConfigured ? "run_env" : "none",
  };

  const tokenConfigured = Boolean(token);

  return {
    tokenConfigured,
    internalRunsEnabled: tokenConfigured && redis.configured,
    token: tokenConfigured ? token : "",
    workerConcurrency: readPositiveInt("RUN_WORKER_CONCURRENCY", 8),
    eventBatchMs: readPositiveInt("RUN_EVENTS_BATCH_MS", 50),
    eventBatchBytes: readPositiveInt("RUN_EVENTS_BATCH_BYTES", 2048),
    heartbeatIntervalMs: readPositiveInt("RUN_HEARTBEAT_INTERVAL_MS", 5000),
    cancelPollMs: readPositiveInt("RUN_CANCEL_POLL_MS", 1000),
    resultTtlSeconds: readPositiveInt("RUN_RESULT_TTL_SECONDS", 3600),
    redis,
  };
}
