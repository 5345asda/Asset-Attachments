import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { join } from "node:path";
import { existsSync } from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
          query: req.query && Object.keys(req.query).length ? req.query : undefined,
          ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress,
          userAgent: req.headers["user-agent"],
          contentType: req.headers["content-type"],
          contentLength: req.headers["content-length"]
            ? Number(req.headers["content-length"])
            : undefined,
          authorization: req.headers["authorization"]
            ? "[REDACTED]"
            : undefined,
          xApiKey: req.headers["x-api-key"] ? "[REDACTED]" : undefined,
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
          contentType: res.getHeader?.("content-type"),
          contentLength: res.getHeader?.("content-length"),
        };
      },
    },
  }),
);
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

export default app;
