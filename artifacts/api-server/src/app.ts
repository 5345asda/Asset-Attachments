import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { join } from "node:path";
import { existsSync } from "node:fs";
import router from "./routes";
import internalRunsRouter from "./routes/internal-runs";
import { logger } from "./lib/logger";
import { ApiError, handleRouteError } from "./lib/api-error";
import { createHttpLoggerOptions } from "./lib/request-context";

const app: Express = express();

app.use(pinoHttp(createHttpLoggerOptions()));
app.use(cors());
app.use(express.json({ limit: "1gb" }));
app.use(express.urlencoded({ extended: true, limit: "1gb" }));

app.use("/internal", internalRunsRouter);
app.use("/api", router);

const staticDir = process.env["STATIC_DIR"];
if (staticDir && existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(join(staticDir, "index.html"));
  });
  logger.info({ staticDir }, "Serving static frontend files");
}

app.use((req, _res, next) => {
  next(new ApiError({
    status: 401,
    message: "Unauthorized",
    code: "route_not_found",
    details: {
      method: req.method,
      path: req.originalUrl,
    },
    logLevel: "warn",
  }));
});

app.use(handleRouteError);

export default app;
