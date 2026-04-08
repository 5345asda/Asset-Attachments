# Workspace

## Overview

AI Proxy Server — OpenAI-compatible multi-model gateway routing to Anthropic, OpenAI, and Google Gemini via Replit AI Integrations. Includes a React status page.

## Artifacts

- **`artifacts/api-server`** — Express 5 API server (`/api`)
- **`artifacts/status-page`** — React + Vite status UI (`/`)

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Logging**: pino + pino-http (structured JSON, pretty in dev)
- **Frontend**: React + Vite + Tailwind + shadcn/ui
- **Build**: esbuild (CJS bundle for API server)

## AI Integrations (Replit-managed, no manual keys)

| Provider | URL env var | Key env var |
|----------|-------------|-------------|
| Anthropic | `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | `AI_INTEGRATIONS_ANTHROPIC_API_KEY` |
| OpenAI | `AI_INTEGRATIONS_OPENAI_BASE_URL` | `AI_INTEGRATIONS_OPENAI_API_KEY` |
| Gemini | `AI_INTEGRATIONS_GEMINI_BASE_URL` | `AI_INTEGRATIONS_GEMINI_API_KEY` |

## Key Commands

- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/status-page run dev` — run status page locally
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages

## API Routes

| Path | Auth | Description |
|------|------|-------------|
| `GET /api/healthz` | No | Health check |
| `GET /api/proxy-info` | No | Returns proxy key + provider list |
| `GET /api/v1/models` | Yes | List all supported models |
| `POST /api/v1/chat/completions` | Yes | Unified proxy (OpenAI format) |
| `/api/anthropic/*` | Yes | Anthropic passthrough |
| `/api/openai/*` | Yes | OpenAI passthrough |
| `/api/gemini/*` | Yes | Gemini passthrough |

## Auth

Proxy key lookup order: `PROXY_API_KEY` env var → `.data/proxy-key` file (auto-generated on first boot).

**IMPORTANT — set `PROXY_API_KEY` as a Secret before deploying.** The auto-generated file fallback uses `process.cwd()` which differs between dev (package directory) and production (workspace root), so the key silently regenerates on every new deployment and breaks all clients. Pin it once as a Secret and it never changes.

Pass as `Authorization: Bearer <key>` or `x-api-key: <key>`.

## Deployment Checklist

1. Set up AI Integrations (Anthropic, OpenAI, Gemini) via `setupReplitAIIntegrations` ✅ DONE
2. **Set `PROXY_API_KEY` secret** ✅ DONE (sk-proxy-5c4154d49d8969bf632488b093d069c5)
3. Restart API Server workflow ✅ DONE
4. Publish

## Known Behaviors

- **temperature + top_p conflict (Anthropic)**: Automatically resolved — `top_p` is dropped when both are present. A WARN log is emitted.
- **cache_control.scope (Anthropic/Vertex AI)**: Stripped automatically — Vertex AI rejects unknown `scope` field.
- **thinking blocks (Anthropic)**: Passed through as-is including `signature` — Vertex AI requires the signature field to be present.
- **Auth failures**: Logged as WARN with `reason` field: `missing_auth_header` / `invalid_bearer_token` / `invalid_x_api_key`

## GitHub

Repository: https://github.com/5345asda/Asset-Attachments
