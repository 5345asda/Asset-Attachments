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

- `pnpm dev` — build the status page and serve everything through the API server (single Replit-style entrypoint)
- `pnpm start` — start the unified deployment entrypoint from existing build output
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `VITE_API_PROXY_TARGET=http://127.0.0.1:8080 pnpm --filter @workspace/status-page run dev` — run status page locally against the API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages

## Replit Configuration

- `.replit run = "pnpm dev"` — the Workspace Run button uses the unified app entrypoint
- `.replit deployment.build = "pnpm run build"` — deployments compile the API server and status page before boot
- `.replit deployment.run = "pnpm start"` — deployments boot the already-built unified server
- `.replit [[ports]] localPort = 3000` — the unified app now exposes a single public web port

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

Proxy key lookup order: `PROXY_API_KEY` env var → `.data/proxy-key` file (自动生成并持久保存，重启不重新生成).

Pass as `Authorization: Bearer <key>` or `x-api-key: <key>`.

## Proxy Key Behavior

**自动生成、持久复用（无需手动操作）：**

1. **首次启动时自动生成** — 服务器第一次启动时会自动在 `artifacts/api-server/.data/proxy-key` 生成并保存一个 Key。
2. **后续每次重启/重新部署都复用同一个 Key** — 只要容器未被完全重置，文件就一直存在，不会重新生成。
3. **可选：通过 Replit Secret 固定 Key** — 如果需要在容器完全重置后也保持同一个 Key（避免客户端收到 401 错误），可以将当前 Key 的值保存为名为 `PROXY_API_KEY` 的 Replit Secret。设置后 Secret 优先级高于文件，始终生效。
4. **获取当前 Key** — 在状态页面（`/`）可以查看并复制当前 Key，也可以读取 `artifacts/api-server/.data/proxy-key` 文件。

## GitHub

Repository: https://github.com/5345asda/Asset-Attachments
