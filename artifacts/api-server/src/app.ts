import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { join } from "node:path";
import { existsSync } from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { handleRouteError } from "./lib/api-error";
import { createHttpLoggerOptions } from "./lib/request-context";

const app: Express = express();

app.use(pinoHttp(createHttpLoggerOptions()));
app.use(cors());
app.use(express.json({ limit: "1gb" }));
app.use(express.urlencoded({ extended: true, limit: "1gb" }));

app.use("/api", router);

const staticDir = process.env["STATIC_DIR"];
if (staticDir && existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(join(staticDir, "index.html"));
  });
  logger.info({ staticDir }, "Serving static frontend files");
}

app.use(handleRouteError);

export default app;
