import app from "./app";
import { logger } from "./lib/logger";
import { getAnthropicProviderConfig } from "./lib/anthropic-provider";
import { getGeminiProviderConfig } from "./lib/gemini-provider";
import { getOpenRouterProviderConfig } from "./lib/openrouter-provider";

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
  const openrouter = getOpenRouterProviderConfig();
  logger.info(
    {
      providers: {
        anthropic: anthropic.configured,
        gemini: gemini.configured,
        openrouter: openrouter.configured,
      },
      providerSources: {
        anthropic: anthropic.source,
        gemini: gemini.source,
        openrouter: openrouter.source,
      },
    },
    "Provider integration status",
  );
  logger.info({ port }, "Server listening");
});
