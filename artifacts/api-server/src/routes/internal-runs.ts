import { Router, type IRouter } from "express";
import { getAnthropicProviderConfig } from "../lib/anthropic-provider";
import { ApiError } from "../lib/api-error";
import { getGeminiProviderConfig } from "../lib/gemini-provider";
import { requireInternalRunsAuth } from "../lib/internal-auth";
import { getInternalRunsConfig } from "../lib/internal-run-config";
import { getOpenAIProviderConfig } from "../lib/openai-provider";
import { getOpenRouterProviderConfig } from "../lib/openrouter-provider";
import { getRunRegistry } from "../lib/run-registry";
import { parseInternalRunEnvelope } from "../lib/run-schema";

const router: IRouter = Router();

function readRouteParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0]?.trim() || "";
  }

  return value?.trim() || "";
}

router.get("/healthz", (_req, res) => {
  const config = getInternalRunsConfig();
  const registry = getRunRegistry();
  const anthropic = getAnthropicProviderConfig();
  const gemini = getGeminiProviderConfig();
  const openrouter = getOpenRouterProviderConfig();
  const openai = getOpenAIProviderConfig();

  res.json({
    status: "ok",
    mode: "private_executor",
    internalRunsEnabled: config.internalRunsEnabled,
    redis: {
      configured: config.redis.configured,
    },
    workers: {
      concurrency: config.workerConcurrency,
      activeRuns: registry.activeRunCount(),
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
  });
});

router.post("/runs", requireInternalRunsAuth, (req, res, next) => {
  const envelope = parseInternalRunEnvelope(req.body);
  if (!envelope) {
    next(new ApiError({
      status: 400,
      message: "Invalid internal run envelope",
      code: "invalid_internal_run_envelope",
      logLevel: "warn",
    }));
    return;
  }

  getRunRegistry().accept(envelope);
  res.status(202).json({
    ok: true,
    runId: envelope.runId,
    status: "accepted",
  });
});

router.post("/runs/:id/cancel", requireInternalRunsAuth, (req, res, next) => {
  const runId = readRouteParam(req.params.id);
  if (!runId) {
    next(new ApiError({
      status: 400,
      message: "Invalid internal run id",
      code: "invalid_internal_run_id",
      logLevel: "warn",
    }));
    return;
  }

  const record = getRunRegistry().requestCancel(runId, typeof req.body?.reason === "string" ? req.body.reason : undefined);
  if (!record) {
    next(new ApiError({
      status: 404,
      message: "Internal run not found",
      code: "internal_run_not_found",
      logLevel: "warn",
    }));
    return;
  }

  res.json({
    ok: true,
    runId: record.runId,
    cancelRequested: true,
  });
});

export default router;
