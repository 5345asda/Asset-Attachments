# Internal Runs API

## Overview

`Asset-Attachments` now exposes two API surfaces:

- Public compatibility APIs under `/api/*`
- Private background execution APIs under `/internal/*`

The private executor runs inside the same web process, persists run state to Redis, and reuses the same provider execution core as the public proxy routes.

## Required Environment Variables

### Public Proxy Auth

| Name | Required | Default | Notes |
|------|----------|---------|-------|
| `PROXY_API_KEY` | Yes | None | Required for authenticated public `/api/*` proxy calls. No hardcoded fallback remains. |

### Internal Executor Auth

| Name | Required | Default | Notes |
|------|----------|---------|-------|
| `INTERNAL_RUNS_TOKEN` | Yes | None | Bearer token or `x-internal-runs-token` value for `/internal/runs*`. |

### Internal Run Redis

| Name | Required | Default | Notes |
|------|----------|---------|-------|
| `RUN_REDIS_URL` | Yes | None | Redis connection URL such as `redis://...` or `rediss://...`. |
| `RUN_REDIS_USERNAME` | No | Empty | Optional ACL username. |
| `RUN_REDIS_PASSWORD` | Yes | None | Redis password. |
| `RUN_REDIS_KEY_PREFIX` | No | `aa` | Prefix for all run keys. |
| `RUN_REDIS_CONNECT_TIMEOUT_MS` | No | `5000` | Redis socket connect timeout. |
| `RUN_REDIS_TLS_CA_PEM_B64` | No | Empty | Base64 PEM CA bundle for TLS Redis. |
| `RUN_RESULT_TTL_SECONDS` | No | `3600` | TTL applied to run meta/events/final/error/cancel keys. |

### Internal Worker Tuning

| Name | Required | Default | Notes |
|------|----------|---------|-------|
| `RUN_WORKER_CONCURRENCY` | No | `8` | Max number of active background runs started by this process. |
| `RUN_CANCEL_POLL_MS` | No | `1000` | Poll interval for Redis cancel markers. |
| `RUN_EVENTS_BATCH_MS` | No | `50` | Reserved config surface from the original design. Current in-repo executor writes events per observed chunk. |
| `RUN_EVENTS_BATCH_BYTES` | No | `2048` | Reserved config surface from the original design. Current in-repo executor writes events per observed chunk. |
| `RUN_HEARTBEAT_INTERVAL_MS` | No | `5000` | Reserved config surface from the original design for future durable worker separation. |

## Public API Notes

Public compatibility routes remain available:

- `POST /api/anthropic/*`
- `POST /api/gemini/*`
- `POST /api/openrouter/*`
- `POST /api/openai/*`

They now run through shared provider execution modules, so the same request normalization and upstream handling is used by both public requests and internal background runs.

## Internal Auth

Protected internal routes accept either:

- `Authorization: Bearer <INTERNAL_RUNS_TOKEN>`
- `x-internal-runs-token: <INTERNAL_RUNS_TOKEN>`

`GET /internal/healthz` is intentionally unauthenticated and returns capability state only. It does not leak tokens, URLs, usernames, or passwords.

## Internal Routes

### `GET /internal/healthz`

Returns executor/process status.

Example response:

```json
{
  "status": "ok",
  "mode": "private_executor",
  "internalRunsEnabled": true,
  "redis": {
    "configured": true,
    "connected": true
  },
  "workers": {
    "concurrency": 8,
    "activeRuns": 1,
    "queuedRuns": 3
  },
  "providers": {
    "anthropic": { "configured": true },
    "gemini": { "configured": true },
    "openrouter": { "configured": true },
    "openai": { "configured": true }
  }
}
```

If Redis env is configured but the socket cannot currently connect, this route still returns `200` with `redis.connected: false` so probes can distinguish "misconfigured or down backend" from "route missing or hung".

### `POST /internal/runs`

Accepts a background run and returns immediately with `202 Accepted`.

Request body:

```json
{
  "runId": "run_123",
  "provider": "openai",
  "routePath": "/v1/chat/completions",
  "method": "POST",
  "headers": {
    "content-type": "application/json"
  },
  "body": {
    "model": "gpt-5",
    "messages": [
      { "role": "user", "content": "hello" }
    ],
    "stream": true
  },
  "stream": true,
  "createdAt": "2026-05-14T10:00:00.000Z"
}
```

Field rules:

- `provider`: one of `anthropic`, `gemini`, `openai`, `openrouter`
- `routePath`: provider-relative path, for example `/v1/messages`, `/v1/chat/completions`, `/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse`
- `headers`: string-to-string map that will be forwarded through the shared provider execution layer
- `stream`: declares whether the caller expects a streaming upstream interaction

Success response:

```json
{
  "ok": true,
  "runId": "run_123",
  "status": "accepted"
}
```

Failure modes:

- `400 invalid_internal_run_envelope`
- `401 unauthorized_internal_runs`
- `409 internal_run_already_exists`
- `503 internal_runs_not_configured`
- `503 internal_runs_redis_not_configured`
- `503 internal_runs_redis_unavailable`

### `POST /internal/runs/:id/cancel`

Requests cancellation of a previously accepted run.

Optional body:

```json
{
  "reason": "user requested"
}
```

Success response:

```json
{
  "ok": true,
  "runId": "run_123",
  "cancelRequested": true
}
```

Failure modes:

- `401 unauthorized_internal_runs`
- `404 internal_run_not_found`
- `503 internal_runs_not_configured`
- `503 internal_runs_redis_unavailable`

## Run Status Lifecycle

Status values persisted in Redis meta:

- `accepted`
- `running`
- `streaming`
- `completed`
- `failed`
- `cancel_requested`
- `cancelled`

Typical flow:

1. `POST /internal/runs` writes `accepted`
2. Worker slot opens and run becomes `running`
3. If stream chunks are observed, state becomes `streaming`
4. Terminal state becomes `completed`, `failed`, or `cancelled`

## Redis Key Contract

For `RUN_REDIS_KEY_PREFIX=aa` and `runId=run_123`, the executor writes:

- `aa:run:run_123:meta`
- `aa:run:run_123:events`
- `aa:run:run_123:final`
- `aa:run:run_123:error`
- `aa:run:run_123:cancel`

### `:meta`

Redis hash with request metadata and lifecycle fields:

- request identity: `runId`, `provider`, `routePath`, `method`
- original request payload snapshots: `requestHeadersJson`, `requestBodyJson`
- runtime fields: `status`, `createdAt`, `updatedAt`, `startedAt`, `completedAt`
- cancel/error fields when applicable

### `:events`

Redis list of streamed wire data entries. Each list item is JSON:

```json
{
  "data": "data: hello\n\n"
}
```

### `:final`

Redis string containing JSON for successful terminal output:

```json
{
  "status": 200,
  "contentType": "application/json",
  "bodyText": "{\"ok\":true}",
  "eventCount": 0,
  "completedAt": "2026-05-14T10:00:01.000Z"
}
```

For non-text payloads the executor stores `bodyBase64` instead of `bodyText`.

### `:error`

Redis string containing JSON for internal execution failures:

```json
{
  "failedAt": "2026-05-14T10:00:02.000Z",
  "message": "Internal run execution failed",
  "code": "internal_proxy_error"
}
```

### `:cancel`

Redis string containing JSON for cancel requests:

```json
{
  "reason": "user requested",
  "cancelRequestedAt": "2026-05-14T10:00:03.000Z"
}
```

## Compatibility Notes

- Public `/api/*` routes are still the client-facing compatibility layer.
- Internal runs do not call back into this service over HTTP; they invoke the shared provider execution core directly.
- The current executor is Redis-backed for state persistence but still hosted inside the web process, so it improves observability and cancelability without claiming an external durable worker lifecycle.
