# AI Proxy Gateway

这个仓库现在只保留 Anthropic 原生接口代理。

- 对外只支持 `/api/anthropic/*`
- 不再提供 `/api/v1/chat/completions`
- 不再提供 OpenAI / Gemini / OpenRouter 路由

## Replit 直接部署

最简单的方式就是直接部署，不要中转复制：

1. 在 Replit 里直接导入这个 GitHub 仓库。
2. 先启用当前项目的 Anthropic integration。
3. 执行 `pnpm install`。
4. 点 Run，根目录 `.replit` 会跑 `pnpm dev`。
5. 点 Deploy，根目录 `.replit` 会用 build=`pnpm run build`、run=`pnpm start`。

不要做这些事：

- 不要先 clone 到临时目录再把文件 copy 到另一个 Replit 项目。
- 不要把 `artifacts/status-page` 和 `artifacts/api-server` 当成两个独立应用重新部署。
- 不要忽略根目录 `.replit`，它就是这个仓库的唯一部署入口。
- 不要把 Replit 自动生成的 `.replit-artifact` 元数据重新提交回仓库。

## 架构

```text
客户端
  │  x-api-key: <proxy-key>
  ▼
┌─────────────────────────────┐
│ Express API Server          │
│ /api/healthz                │
│ /api/proxy-info             │
│ /api/anthropic/v1/models    │
│ /api/anthropic/v1/messages  │
└──────────┬──────────────────┘
           │
           ▼
       Anthropic
```

## 快速开始

### Replit AI 部署约定

如果你是在 Replit 里交给 AI 自动部署，先按这条理解仓库，不要自己重组结构：

- 根目录 `.replit` 就是唯一的部署入口
- 对外是单入口：`/` 为状态页，`/api/*` 为 API
- 不要把 `artifacts/status-page` 和 `artifacts/api-server` 当成两个独立对外服务重新拆分发布
- 仓库不再提交 `.replit-artifact` 目录，避免 Replit AI 读取到第二套冲突拓扑

### 1. 先启用 Replit Anthropic 集成

首次在新的 Replit 项目里运行前，必须先启用 Anthropic 集成。仓库自身不会生成这些环境变量。

需要的变量：

- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY`

### 2. 启动

```bash
pnpm install
pnpm dev
```

启动后：

- 状态页由统一入口托管
- Anthropic 根路径是 `/api/anthropic`
- 页面会显示当前 Base URL 和 Proxy Key
- 如果当前 Replit 项目还没启用 Anthropic 集成，页面状态会显示 `Setup Required`
- 服务日志会打印 `Provider integration status`，只显示 `anthropic`

### 3. 获取 Base URL 和 Proxy Key

部署后访问根路径 `/`，页面会显示：

- Base URL，例如 `https://your-app.replit.app/api/anthropic`
- Proxy Key，例如 `sk-proxy-xxxxx`

### 4. 用 curl 调用

```bash
BASE_URL="https://your-app.replit.app/api/anthropic"
PROXY_KEY="sk-proxy-xxxxx"

curl "$BASE_URL/v1/messages" \
  -H "x-api-key: $PROXY_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 1024,
    "messages": [{"role":"user","content":"Hello!"}]
  }'
```

## API 概览

| 路径 | 认证 | 说明 |
|------|------|------|
| `GET /api/healthz` | 否 | 健康检查 |
| `GET /api/proxy-info` | 否 | 返回当前 Proxy Key 和 provider 信息 |
| `GET /api/anthropic/v1/models` | 是 | 返回 Claude 模型列表 |
| `POST /api/anthropic/v1/messages` | 是 | Anthropic 原生 messages 接口 |

## 认证

支持两种传法：

```text
Authorization: Bearer sk-proxy-xxxxx
```

```text
x-api-key: sk-proxy-xxxxx
```

## Proxy Key 持久化

Proxy Key 的优先级是：

1. `PROXY_API_KEY`
2. `artifacts/api-server/.data/proxy-key`
3. 首次启动自动生成

补充说明：

- `proxy-key` 文件路径现在锚定在 `artifacts/api-server` 包目录下，不依赖你从仓库根目录还是子目录启动。
- 首次启动会自动生成并写入 `artifacts/api-server/.data/proxy-key`。
- 只要容器数据没被完全清空，后续重启 / 重部署会复用同一个 Key。
- 如果担心容器重置后 Key 变化，直接设置 Replit Secret `PROXY_API_KEY`。

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PROXY_API_KEY` | 固定代理 Key | 自动生成 |
| `TOKEN_MARKUP` | Token 计费倍率 | `1.0` |
| `PORT` | API 服务端口 | 由运行环境分配 |

Anthropic 凭证默认走 Replit 注入的环境变量：

- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY`

## 本地开发和部署

### 本地单入口

```bash
pnpm dev
```

这会先构建状态页，再由 API 服务统一托管前后端。

适用场景：

- 本地第一次启动
- 想确保当前源码已经重新构建并生效
- 刚导入仓库、刚 `git pull`、刚替换过文件

### 本地分离调试

```bash
pnpm --filter @workspace/api-server run dev
VITE_API_PROXY_TARGET=http://127.0.0.1:8080 pnpm --filter @workspace/status-page run dev
```

### 构建和启动产物

```bash
pnpm run build
pnpm start
```

这里要注意两点：

- `pnpm start` 只启动**已有构建产物**
- 它不会自动根据最新源码重新构建

所以如果你刚导入新代码、刚 `git pull`、或者刚改完文件，先跑 `pnpm run build`，再跑 `pnpm start`。不然就可能继续跑旧的 `dist`，出现“源码里已经有路由，但运行时还是旧行为”的情况。

对应关系：

- Replit `Run`：`pnpm dev`
- Replit Deployment build：`pnpm run build`
- Replit Deployment run：`pnpm start`

### 新项目首次部署 checklist

1. 在 Replit 里创建 / 导入当前仓库
2. 先启用 Anthropic 集成，而不是直接启动
3. 确认对应 `AI_INTEGRATIONS_*` 变量已经存在
4. 再执行 `pnpm install`
5. 如果要跑当前最新源码，先执行 `pnpm run build`
6. 再执行 `pnpm dev` 或 `pnpm start`

如果你是在 Replit 里交给别的 AI 继续部署，文档默认的推荐路径是：

- 优先使用 Replit AI Integrations 自动配置 Anthropic 变量
- 不要默认向用户索要单独的 Anthropic API key

## 代码结构

```text
artifacts/
├── api-server/
│   └── src/
│       ├── lib/
│       │   ├── api-error.ts
│       │   ├── anthropic-request.ts
│       │   ├── proxy-key.ts
│       │   ├── stream.ts
│       │   └── request-context.ts
│       └── routes/
│           └── passthrough.ts
└── status-page/
    └── src/
```

### 关键职责

- `routes/passthrough.ts`
  只保留 Anthropic 原生透传。
- `lib/anthropic-request.ts`
  处理 Anthropic body 清洗和本地校验。
- `lib/stream.ts`
  处理 Anthropic stream 和 usage 调整。

## 排错

### 先看响应头

每个请求都会带 `x-request-id`，查日志时直接用这个值串起来找最快。

### 错误响应结构

对外错误结构保持稳定，不额外塞调试字段：

```json
{
  "error": {
    "message": "....",
    "type": "...."
  }
}
```

### 新项目最常见的坑

如果你在一个全新的 Replit 项目里：

- 直接克隆仓库
- 直接 `pnpm install`
- 直接 `pnpm dev`

但没有先启用 Replit Anthropic 集成，那么最容易遇到的是 provider 相关 503，而不是启动报错。

常见表现：

- 原生透传入口会报 `ANTHROPIC integration not configured`
- `/api/proxy-info` 这类源码里已经存在的接口，在运行时却返回 404；这通常说明当前跑的还是旧构建产物，而不是最新源码

前一类通常是 provider 变量没注入；后一类通常是旧构建产物没更新，不是同一个问题。

### 当前约束

- 不再恢复 `/api/v1/chat/completions` 统一入口。
- 不再恢复 OpenAI / Gemini / OpenRouter 路由。
- Anthropic 的 assistant prefill 仍然在本地先拦截，不等上游返回。
