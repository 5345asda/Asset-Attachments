import { Router, type IRouter } from "express";
import { ApiError } from "../lib/api-error";
import { requireInternalRunsAuth } from "../lib/internal-auth";
import { getInternalRunsService } from "../lib/internal-runs-service";
import { parseInternalRunEnvelope } from "../lib/run-schema";

const router: IRouter = Router();

function readRouteParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0]?.trim() || "";
  }

  return value?.trim() || "";
}

router.get("/healthz", async (_req, res) => {
  res.json(await getInternalRunsService().getHealth());
});

router.post("/runs", requireInternalRunsAuth, async (req, res, next) => {
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

  try {
    res.status(202).json(await getInternalRunsService().submitRun(envelope));
  } catch (error) {
    next(error);
  }
});

router.post("/runs/:id/cancel", requireInternalRunsAuth, async (req, res, next) => {
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

  try {
    const result = await getInternalRunsService().requestCancel(
      runId,
      typeof req.body?.reason === "string" ? req.body.reason : undefined,
    );
    if (!result) {
      next(new ApiError({
        status: 404,
        message: "Internal run not found",
        code: "internal_run_not_found",
        logLevel: "warn",
      }));
      return;
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
