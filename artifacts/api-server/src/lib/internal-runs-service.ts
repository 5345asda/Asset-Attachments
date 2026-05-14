import { ApiError, isApiError } from "./api-error";
import { getAnthropicProviderConfig } from "./anthropic-provider";
import { getGeminiProviderConfig } from "./gemini-provider";
import { getInternalRunsConfig } from "./internal-run-config";
import { logger } from "./logger";
import { getOpenAIProviderConfig } from "./openai-provider";
import { getOpenRouterProviderConfig } from "./openrouter-provider";
import { executeAnthropicRequest } from "./providers/anthropic-execution";
import { executeGeminiRequest } from "./providers/gemini-execution";
import { executeOpenAIRequest } from "./providers/openai-execution";
import { executeOpenRouterRequest } from "./providers/openrouter-execution";
import { getRedisRunStoreClient } from "./redis-client";
import { createRedisRunStore } from "./redis-run-store";
import { createRunExecutor } from "./run-executor";
import { getRunRegistry } from "./run-registry";
import type { InternalRunEnvelope } from "./run-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type RedisRunStore = ReturnType<typeof createRedisRunStore>;
type RunExecutor = ReturnType<typeof createRunExecutor>;

let storePromise: Promise<RedisRunStore> | null = null;
let runExecutor: RunExecutor | null = null;
const pendingRuns: InternalRunEnvelope[] = [];
let activeExecutorCount = 0;
let drainInFlight: Promise<void> | null = null;

async function getStore(): Promise<RedisRunStore> {
  const config = getInternalRunsConfig();
  if (!config.redis.configured) {
    throw new ApiError({
      status: 503,
      message: "Internal runs Redis not configured",
      type: "service_unavailable",
      code: "internal_runs_redis_not_configured",
      logLevel: "warn",
    });
  }

  if (!storePromise) {
    storePromise = (async () => {
      const client = await getRedisRunStoreClient();
      return createRedisRunStore({
        client,
        keyPrefix: config.redis.keyPrefix,
        resultTtlSeconds: config.resultTtlSeconds,
      });
    })();
  }

  try {
    return await storePromise;
  } catch (error) {
    storePromise = null;
    throw toRedisUnavailableError(error);
  }
}

function toRedisUnavailableError(error: unknown): ApiError {
  if (isApiError(error)) {
    return error;
  }

  return new ApiError({
    status: 503,
    message: "Internal runs Redis unavailable",
    type: "service_unavailable",
    code: "internal_runs_redis_unavailable",
    details: {
      reason: error instanceof Error ? error.message : String(error),
    },
    logLevel: "error",
    cause: error,
  });
}

async function withRedisAvailability<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw toRedisUnavailableError(error);
  }
}

function toExecutionBody(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

async function executeInternalProviderRequest(params: {
  envelope: InternalRunEnvelope;
  abortSignal: AbortSignal;
}) {
  const request = {
    method: params.envelope.method,
    path: params.envelope.routePath,
    url: params.envelope.routePath,
    headers: params.envelope.headers,
    body: toExecutionBody(params.envelope.body),
  };
  const executionLogger = logger.child({
    runId: params.envelope.runId,
    provider: params.envelope.provider,
  });

  switch (params.envelope.provider) {
    case "anthropic":
      return await executeAnthropicRequest({
        request,
        provider: getAnthropicProviderConfig(),
        logger: executionLogger,
        abortSignal: params.abortSignal,
      });
    case "gemini":
      return await executeGeminiRequest({
        request,
        provider: getGeminiProviderConfig(),
        logger: executionLogger,
        abortSignal: params.abortSignal,
      });
    case "openai":
      return await executeOpenAIRequest({
        request,
        provider: getOpenAIProviderConfig(),
        logger: executionLogger,
        abortSignal: params.abortSignal,
      });
    case "openrouter":
      return await executeOpenRouterRequest({
        request,
        provider: getOpenRouterProviderConfig(),
        logger: executionLogger,
        abortSignal: params.abortSignal,
      });
    default:
      throw new ApiError({
        status: 400,
        message: "Unsupported internal run provider",
        type: "invalid_request_error",
        code: "unsupported_internal_run_provider",
        details: {
          provider: params.envelope.provider,
        },
        logLevel: "warn",
      });
  }
}

async function getExecutor(): Promise<RunExecutor> {
  if (!runExecutor) {
    const config = getInternalRunsConfig();
    runExecutor = createRunExecutor({
      store: await getStore(),
      registry: getRunRegistry(),
      logger,
      cancelPollMs: config.cancelPollMs,
      executeProvider: executeInternalProviderRequest,
    });
  }

  return runExecutor;
}

async function drainQueue(): Promise<void> {
  if (drainInFlight) {
    return await drainInFlight;
  }

  drainInFlight = (async () => {
    const config = getInternalRunsConfig();
    const executor = await getExecutor();

    while (activeExecutorCount < config.workerConcurrency && pendingRuns.length > 0) {
      const nextEnvelope = pendingRuns.shift();
      if (!nextEnvelope) {
        break;
      }

      activeExecutorCount += 1;
      void executor.start(nextEnvelope).finally(() => {
        activeExecutorCount = Math.max(0, activeExecutorCount - 1);
        void drainQueue();
      });
    }
  })();

  try {
    await drainInFlight;
  } finally {
    drainInFlight = null;
  }
}

function assertInternalRunsEnabled(): void {
  const config = getInternalRunsConfig();
  if (!config.internalRunsEnabled) {
    throw new ApiError({
      status: 503,
      message: "Internal runs are not configured",
      type: "service_unavailable",
      code: "internal_runs_not_configured",
      logLevel: "warn",
    });
  }
}

export function getInternalRunsService() {
  return {
    async getHealth(): Promise<{
      status: "ok";
      mode: "private_executor";
      internalRunsEnabled: boolean;
      redis: {
        configured: boolean;
        connected: boolean;
      };
      workers: {
        concurrency: number;
        activeRuns: number;
        queuedRuns: number;
      };
      providers: Record<string, { configured: boolean }>;
    }> {
      const config = getInternalRunsConfig();
      let connected = false;

      if (config.redis.configured) {
        try {
          connected = await (await getStore()).ping();
        } catch {
          connected = false;
        }
      }

      const anthropic = getAnthropicProviderConfig();
      const gemini = getGeminiProviderConfig();
      const openrouter = getOpenRouterProviderConfig();
      const openai = getOpenAIProviderConfig();

      return {
        status: "ok",
        mode: "private_executor",
        internalRunsEnabled: config.internalRunsEnabled,
        redis: {
          configured: config.redis.configured,
          connected,
        },
        workers: {
          concurrency: config.workerConcurrency,
          activeRuns: getRunRegistry().activeRunCount(),
          queuedRuns: pendingRuns.length,
        },
        providers: {
          anthropic: {
            configured: anthropic.configured,
          },
          gemini: {
            configured: gemini.configured,
          },
          openrouter: {
            configured: openrouter.configured,
          },
          openai: {
            configured: openai.configured,
          },
        },
      };
    },

    async submitRun(envelope: InternalRunEnvelope): Promise<{
      ok: true;
      runId: string;
      status: "accepted";
    }> {
      assertInternalRunsEnabled();
      const store = await getStore();
      await withRedisAvailability(async () => {
        const existing = await store.getRunMeta(envelope.runId);
        if (existing) {
          throw new ApiError({
            status: 409,
            message: "Internal run already exists",
            type: "invalid_request_error",
            code: "internal_run_already_exists",
            details: {
              runId: envelope.runId,
            },
            logLevel: "warn",
          });
        }

        await store.acceptRun(envelope);
      });
      pendingRuns.push(envelope);
      void drainQueue();

      return {
        ok: true,
        runId: envelope.runId,
        status: "accepted",
      };
    },

    async requestCancel(runId: string, reason?: string): Promise<{
      ok: true;
      runId: string;
      cancelRequested: true;
    } | null> {
      assertInternalRunsEnabled();
      const store = await getStore();
      const found = await withRedisAvailability(async () => await store.requestCancel(runId, reason));
      if (!found) {
        return null;
      }

      getRunRegistry().requestCancel(runId, reason);
      return {
        ok: true,
        runId,
        cancelRequested: true,
      };
    },
  };
}
