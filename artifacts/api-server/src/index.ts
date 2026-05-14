import app from "./app";
import { logger } from "./lib/logger";
import { getAnthropicProviderConfig } from "./lib/anthropic-provider";
import { getGeminiProviderConfig } from "./lib/gemini-provider";
import { getInternalRunsConfig } from "./lib/internal-run-config";
import { getOpenRouterProviderConfig } from "./lib/openrouter-provider";
import { getRedisConfig } from "./lib/redis-config";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  const anthropic = getAnthropicProviderConfig();
  const gemini = getGeminiProviderConfig();
  const internalRuns = getInternalRunsConfig();
  const openrouter = getOpenRouterProviderConfig();
  const redis = getRedisConfig();
  logger.info(
    {
      internalRuns: {
        enabled: internalRuns.internalRunsEnabled,
        tokenConfigured: internalRuns.tokenConfigured,
        redisConfigured: internalRuns.redis.configured,
        workerConcurrency: internalRuns.workerConcurrency,
      },
      providers: {
        anthropic: anthropic.configured,
        gemini: gemini.configured,
        openrouter: openrouter.configured,
        redis: redis.configured,
      },
      providerSources: {
        anthropic: anthropic.source,
        gemini: gemini.source,
        openrouter: openrouter.source,
        redis: redis.source,
      },
    },
    "Provider integration status",
  );
  logger.info({ port }, "Server listening");
});
