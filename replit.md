# Workspace

## Overview

这是一个 Replit 风格的 AI Proxy 单仓库：

- `artifacts/api-server` 提供统一 API 入口和 provider 转发
- `artifacts/status-page` 提供状态页和使用说明
- 最终以一个统一入口对外暴露：根路径是状态页，`/api/*` 是服务端接口

当前维护目标很明确：

- 对外接口稳定，客户端继续按 OpenAI 兼容方式调用
- 对内结构保持轻量，避免把 provider 分支重新堆回 `proxy.ts`

## Stack

- Monorepo: pnpm workspaces
- Node.js: 24
- TypeScript: 5.9
- API: Express 5
- Logging: pino + pino-http
- Frontend: React + Vite + Tailwind + shadcn/ui
- API build: esbuild

## Entry Points

### 新项目首次部署前置条件

这份仓库文档默认你在 Replit 环境里运行，但有一个很容易漏掉的前置步骤：

- 新建一个 Replit 项目并导入这个仓库之后
- 不能只做 `pnpm install` / `pnpm dev`
- 必须先在**当前 Replit 项目**里启用你要用的 AI provider 集成

原因很简单：

- `AI_INTEGRATIONS_*` 变量不是仓库自带的
- `pnpm dev` 不会替你生成这些变量
- 只有当前 Replit 项目里对应集成被启用后，这些变量才会出现在运行环境里

需要的变量映射：

| Provider | URL env var | Key env var |
|----------|-------------|-------------|
| Anthropic | `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | `AI_INTEGRATIONS_ANTHROPIC_API_KEY` |
| OpenAI | `AI_INTEGRATIONS_OPENAI_BASE_URL` | `AI_INTEGRATIONS_OPENAI_API_KEY` |
| Gemini | `AI_INTEGRATIONS_GEMINI_BASE_URL` | `AI_INTEGRATIONS_GEMINI_API_KEY` |

如果只启用部分 provider，也可以正常跑；只是访问未启用 provider 时会得到 503 配置错误。

### 本地开发

- `pnpm dev`
  先构建状态页，再由 API 服务统一托管，行为最接近 Replit `Run`
- `pnpm --filter @workspace/api-server run dev`
  只启动 API 服务
- `VITE_API_PROXY_TARGET=http://127.0.0.1:8080 pnpm --filter @workspace/status-page run dev`
  本地单独调试状态页，`/api/*` 代理到 API 服务

补充说明：

- `pnpm dev` 会先跑完整构建，不是秒开的 dev server
- 在 Replit 里首次运行时，端口起来之前可能要先经历一段 build
- 如果 Replit `Run` 看起来像超时，先确认是不是还在 build，而不是直接判断服务坏了

### 部署

- `pnpm run build`
  构建所有需要的产物
- `pnpm start`
  从现有构建产物启动统一入口

重点：

- `pnpm start` 不会自动重建最新源码
- 它只会启动当前磁盘上已经存在的 `dist` 产物
- 所以导入新代码、`git pull`、或者手工覆盖文件后，必须先重新 `pnpm run build`

### `.replit`

- `run = "pnpm dev"`
- `deployment.build = "pnpm run build"`
- `deployment.run = "pnpm start"`
- `[[ports]].localPort = 3000`

## Runtime Structure

### 对外路由

| Path | Auth | Description |
|------|------|-------------|
| `GET /api/healthz` | No | Health check |
| `GET /api/proxy-info` | No | Returns proxy key + provider info |
| `GET /api/v1/models` | Yes | Unified model list |
| `POST /api/v1/chat/completions` | Yes | Unified OpenAI-compatible entry |
| `/api/anthropic/*` | Yes | Anthropic passthrough |
| `/api/openai/*` | Yes | OpenAI passthrough |
| `/api/gemini/*` | Yes | Gemini passthrough |

### API 服务内部职责

```text
artifacts/api-server/src/
├── lib/
│   ├── api-error.ts
│   ├── proxy-key.ts
│   └── request-context.ts
└── routes/
    ├── proxy.ts
    ├── passthrough.ts
    └── providers/chat-completions/
        ├── index.ts
        ├── catalog.ts
        ├── request.ts
        ├── openai.ts
        ├── anthropic.ts
        ├── gemini.ts
        └── types.ts
```

### 维护边界

- `proxy.ts`
  保持薄。这里只做统一入口、请求日志、request resolve、provider dispatch。
- `providers/chat-completions/index.ts`
  只做 registry / re-export，不写 provider 细节。
- `providers/chat-completions/catalog.ts`
  维护统一 `/models` 返回。
- `providers/chat-completions/request.ts`
  维护模型校验、provider 解析、provider 凭证解析。
- `providers/chat-completions/{openai,anthropic,gemini}.ts`
  各 provider 实际转发逻辑。

如果后面要加新 provider，优先按这个结构加，不要把 `if/else` 再塞回 `proxy.ts`。

## Provider Environment

这些变量通常由 Replit AI Integrations 注入。

但这里的“注入”不是仓库导入后自动完成，而是依赖**当前 Replit 项目已经先启用对应 provider 集成**：

| Provider | URL env var | Key env var |
|----------|-------------|-------------|
| Anthropic | `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | `AI_INTEGRATIONS_ANTHROPIC_API_KEY` |
| OpenAI | `AI_INTEGRATIONS_OPENAI_BASE_URL` | `AI_INTEGRATIONS_OPENAI_API_KEY` |
| Gemini | `AI_INTEGRATIONS_GEMINI_BASE_URL` | `AI_INTEGRATIONS_GEMINI_API_KEY` |

额外变量：

- `PROXY_API_KEY`
- `TOKEN_MARKUP`
- `PORT`

在 Replit 部署语境下，默认推荐：

- 优先使用 Replit AI Integrations 自动配置这些 provider 变量
- 不要默认回退到向用户索要单独的 provider API key

## First-Deploy Checklist

1. 在新的 Replit 项目里导入这个仓库
2. 先启用需要的 AI provider 集成
3. 确认对应 `AI_INTEGRATIONS_*` 变量已经存在
4. 再运行 `pnpm install`
5. 再运行 `pnpm run build`
6. 再运行 `pnpm dev` 或 `pnpm start`

如果跳过第 2 步，服务可以启动，但 provider 调用会在运行时失败。
如果跳过第 5 步，服务也可能继续跑旧构建产物。

## Proxy Key

查找顺序：

1. `PROXY_API_KEY`
2. `artifacts/api-server/.data/proxy-key`
3. 首次启动自动生成

注意：

- 路径现在是相对 `artifacts/api-server` 包目录锚定，不依赖当前启动 cwd。
- `artifacts/api-server/.data/proxy-key` 已忽略，不应提交到 git。
- 想固定 Key，直接配 `PROXY_API_KEY`。

## Logging And Error Handling

- 每个请求都会分配或透传 `x-request-id`
- 日志会把请求和响应按同一个 request id 串起来
- 对外错误结构保持稳定：

```json
{
  "error": {
    "message": "....",
    "type": "...."
  }
}
```

不要在返回体里额外增加调试字段；排错主要看 `x-request-id` 和服务端日志。

## Missing-Integration Failure Mode

新项目最容易踩的坑不是安装失败，而是 provider 集成没启用导致的运行时 503。

实际表现：

- 统一 OpenAI 兼容入口：`Provider credentials for '<provider>' are not configured`
- 原生透传入口：`<PROVIDER> integration not configured`
- `/api/proxy-info` 这类源码中已存在的接口仍然返回 404；这通常说明还在跑旧构建产物

所以文档和部署脚本都应该把“先启用 Replit AI Integrations”当成前置条件，而不是默认环境已经配好。

## Startup Visibility

服务启动时会打印一条 `Provider integration status` 日志，直接显示：

- `anthropic: true/false`
- `openai: true/false`
- `gemini: true/false`

这条日志用来尽早暴露“服务能启动，但 provider 变量没注入”的状态，避免部署阶段只看到 `Server listening` 就误以为一切都配好了。

## Behavior Notes

- `claude-*` 路由到 Anthropic
- `gemini-*` 路由到 Gemini
- 其他模型默认走 OpenAI / OpenRouter 兼容逻辑
- Anthropic assistant prefill 会在本地先拒绝，不等上游报错

## Validation

改完 API 路由或 provider 逻辑后，至少跑这两条：

```bash
pnpm test:template
pnpm run build
```

## GitHub

Repository: https://github.com/5345asda/Asset-Attachments
