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
| `GET /api/proxy-info` | No | Returns masked proxy key + provider list (never plaintext) |
| `GET /api/v1/models` | Yes | List all supported models |
| `POST /api/v1/chat/completions` | Yes | Unified proxy (OpenAI format) |
| `/api/anthropic/*` | Yes | Anthropic passthrough |
| `/api/openai/*` | Yes | OpenAI passthrough |
| `/api/gemini/*` | Yes | Gemini passthrough |

## Auth

Proxy key lookup order: `PROXY_API_KEY` env var → `.data/proxy-key` file (auto-generated on first boot, **dev only**).

Pass as `Authorization: Bearer <key>` or `x-api-key: <key>`.

## ⚠️ Proxy Key Rules — Read Before Deploying

1. **Generate once, never again.** Run this command once to create a key:
   ```
   node -e "console.log('sk-proxy-' + require('crypto').randomBytes(16).toString('hex'))"
   ```
2. **Store as a Replit Secret** — go to the Secrets tab and add `PROXY_API_KEY`. Never put the value in code or replit.md.
3. **In production, the server will throw a fatal error if `PROXY_API_KEY` is missing** (not just a warning — it refuses to start). This prevents silent key rotation that would break all clients with 401 errors.
4. **The key is never sent to the browser.** `/api/proxy-info` returns `proxyKeyMasked` (first 14 chars + dots). The status page shows the masked form only; no eye/reveal toggle exists. Retrieve the real key from Replit Secrets.
5. **The status page code examples use `<YOUR_PROXY_KEY>` as a placeholder** — never the real value.

## Known Behaviors

- **temperature + top_p conflict (Anthropic)**: Automatically resolved — `top_p` is dropped when both are present. A WARN log is emitted.
- **cache_control.scope (Anthropic/Vertex AI)**: Stripped automatically — Vertex AI rejects unknown `scope` field.
- **thinking blocks (Anthropic)**: Passed through as-is including `signature` — Vertex AI requires the signature field to be present.
- **Auth failures**: Logged as WARN with `reason` field: `missing_auth_header` / `invalid_bearer_token` / `invalid_x_api_key`

## GitHub

Repository: https://github.com/5345asda/Asset-Attachments
