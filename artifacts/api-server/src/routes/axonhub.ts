import { Router, type IRouter } from "express";
import { ApiError } from "../lib/api-error";
import { AXONHUB_ORIGIN, AxonHubSyncError, syncAxonHubChannel } from "../lib/axonhub";
import { PROXY_API_KEY } from "../lib/proxy-key";

const router: IRouter = Router();

router.post("/axonhub/channel-sync", async (req, res, next) => {
  const token = typeof req.body?.token === "string"
    ? req.body.token.trim()
    : "";
  const projectOrigin = typeof req.body?.projectOrigin === "string"
    ? req.body.projectOrigin.trim()
    : "";

  if (!token) {
    next(new ApiError({
      status: 400,
      message: "AxonHub token is required",
      code: "axonhub_token_required",
    }));
    return;
  }

  if (!projectOrigin) {
    next(new ApiError({
      status: 400,
      message: "Project origin is required",
      code: "project_origin_required",
    }));
    return;
  }

  try {
    new URL(projectOrigin);
  } catch {
    next(new ApiError({
      status: 400,
      message: "Project origin must be a valid URL",
      code: "project_origin_invalid",
    }));
    return;
  }

  if (!PROXY_API_KEY) {
    next(new ApiError({
      status: 503,
      message: "Proxy API key not configured",
      code: "proxy_api_key_not_configured",
      type: "server_error",
    }));
    return;
  }

  try {
    const result = await syncAxonHubChannel({
      projectOrigin,
      proxyKey: PROXY_API_KEY,
      adminToken: token,
    });

    res.json({
      axonhubOrigin: AXONHUB_ORIGIN,
      mode: result.mode,
      provider: result.provider,
      channel: result.channel,
    });
  } catch (error) {
    const syncError = error instanceof AxonHubSyncError
      ? error
      : new AxonHubSyncError("Failed to sync channel to AxonHub", 502);

    next(new ApiError({
      status: syncError.status >= 400 && syncError.status < 500
        ? syncError.status
        : 502,
      message: syncError.message,
      code: "axonhub_channel_sync_failed",
      type: syncError.status === 401 ? "authentication_error" : "server_error",
      cause: error,
      details: {
        axonhubOrigin: AXONHUB_ORIGIN,
      },
    }));
  }
});

export default router;
