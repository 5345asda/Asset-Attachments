import app from "./app";
import { logger } from "./lib/logger";

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

  logger.info(
    {
      providers: {
        anthropic: !!process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"]
          && !!process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"],
      },
    },
    "Provider integration status",
  );
  logger.info({ port }, "Server listening");
});
