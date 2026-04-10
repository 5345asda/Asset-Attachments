# AI Proxy Gateway

OpenAI 兼容的多模型代理网关。统一入口是 `/api/v1/chat/completions`，按 `model` 自动转发到 Anthropic、OpenAI / OpenRouter 或 Gemini；同时提供一个 React 状态页，方便拿到 Base URL、Proxy Key 和示例代码。

这个仓库现在的重点是两件事：

- 对外接口保持稳定，客户端直接按 OpenAI SDK / curl 用就行。
- 对内结构保持轻量，`proxy.ts` 只做路由分发，provider 细节都放到 provider 级模块。

## 架构

```text
客户端 (OpenAI SDK / curl)
      │  Authorization: Bearer <proxy-key>
      ▼
┌─────────────────────────────┐
│ Express API Server          │
│ /api/v1/models              │
│ /api/v1/chat/completions    │
│ /api/{provider}/*           │
└──────────┬──────────────────┘
           │  按 model 路由
     ┌─────┼──────┐
     ▼     ▼      ▼
Anthropic OpenAI Gemini
```

## 快速开始

### 1. 新 Replit 项目先激活 AI provider 集成

这一条是新项目首次部署的前置条件，不是可选项。

如果你是：

- 刚把这个仓库导入 / 克隆到一个新的 Replit 项目
- 第一次在这个 Replit 项目里运行这个代理

那你必须先在当前 Replit 项目里，把要用到的 AI provider 集成启用一次。只有启用之后，Replit 才会把对应的 `AI_INTEGRATIONS_*` 环境变量注入运行环境。

至少需要按实际使用场景启用这些 provider：

- Anthropic
- OpenAI
- Gemini

对应变量是：

- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY`
- `AI_INTEGRATIONS_OPENAI_BASE_URL`
- `AI_INTEGRATIONS_OPENAI_API_KEY`
- `AI_INTEGRATIONS_GEMINI_BASE_URL`
- `AI_INTEGRATIONS_GEMINI_API_KEY`

注意：

- 这些变量**不是**“克隆仓库后天然就有”
- 这些变量**不是**运行 `pnpm install` / `pnpm dev` 后自动生成
- 这些变量只会在对应 provider 集成被当前 Replit 项目启用后出现

如果你只打算用其中一部分 provider，也可以只启用那一部分；未启用的 provider 在实际请求时会返回 503，而不是在启动阶段自动补齐。

### 2. 启动

```bash
pnpm install

# 本地单入口，行为和 Replit Run 接近
pnpm dev
```

启动后：

- 状态页默认由统一入口托管
- API 根路径是 `/api/v1`
- 状态页会显示当前 Base URL 和 Proxy Key

### 3. 先验证 provider 凭证已经注入

第一次部署建议先验证一次，不要直接开始调 Anthropic / OpenAI / Gemini。

最简单的判断方式：

- 你已经在当前 Replit 项目里完成了 provider 集成启用
- 对应 `AI_INTEGRATIONS_*` 变量在运行环境里已经存在
- 访问某个 provider 的实际模型时，不会立刻收到“provider credentials not configured / integration not configured”这类 503

如果这里只做仓库导入、安装依赖、启动服务，但**没有先启用 Replit AI Integrations**，那 README 里后面所有 Anthropic / OpenAI / Gemini 调用示例都不成立。

### 4. 获取 Base URL 和 Proxy Key

部署后访问根路径 `/`，页面会显示：

- Base URL，例如 `https://your-app.replit.app/api/v1`
- Proxy Key，例如 `sk-proxy-xxxxx`

### 5. 用 OpenAI SDK 调用

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://your-app.replit.app/api/v1",
    api_key="sk-proxy-xxxxx",
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}],
)

response = client.chat.completions.create(
    model="claude-opus-4-6",
    messages=[{"role": "user", "content": "Hello!"}],
)

response = client.chat.completions.create(
    model="gemini-2.5-flash",
    messages=[{"role": "user", "content": "Hello!"}],
)
```

### 6. 用 curl 调用

```bash
BASE_URL="https://your-app.replit.app/api/v1"
PROXY_KEY="sk-proxy-xxxxx"

curl "$BASE_URL/chat/completions" \
  -H "Authorization: Bearer $PROXY_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello!"}]}'
```

## API 概览

| 路径 | 认证 | 说明 |
|------|------|------|
| `GET /api/healthz` | 否 | 健康检查 |
| `GET /api/proxy-info` | 否 | 返回当前 Proxy Key 和 provider 信息 |
| `GET /api/v1/models` | 是 | 返回统一模型列表 |
| `POST /api/v1/chat/completions` | 是 | OpenAI 兼容入口，自动路由 |
| `POST /api/anthropic/*` | 是 | Anthropic 原生接口透传 |
| `POST /api/openai/*` | 是 | OpenAI 原生接口透传 |
| `POST /api/gemini/*` | 是 | Gemini 原生接口透传 |

### 模型路由规则

| `model` | provider |
|---------|----------|
| `claude-*` | Anthropic |
| `gemini-*` | Gemini |
| 其他 | OpenAI / OpenRouter |

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

AI provider 凭证默认走 Replit 注入的环境变量。

但这里的前提是：你已经在**当前 Replit 项目**里把对应 provider 集成启用过一次。这个仓库不会替你自动完成那一步。

- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY`
- `AI_INTEGRATIONS_OPENAI_BASE_URL`
- `AI_INTEGRATIONS_OPENAI_API_KEY`
- `AI_INTEGRATIONS_GEMINI_BASE_URL`
- `AI_INTEGRATIONS_GEMINI_API_KEY`

## 本地开发和部署

### 本地单入口

```bash
pnpm dev
```

这会先构建状态页，再由 API 服务统一托管前后端。

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

对应关系：

- Replit `Run`：`pnpm dev`
- Replit Deployment build：`pnpm run build`
- Replit Deployment run：`pnpm start`

### 新项目首次部署 checklist

1. 在 Replit 里创建 / 导入当前仓库
2. 先启用需要的 AI provider 集成，而不是直接启动
3. 确认对应 `AI_INTEGRATIONS_*` 变量已经存在
4. 再执行 `pnpm install`
5. 再执行 `pnpm dev` 或部署流程

## 代码结构

```text
artifacts/
├── api-server/
│   └── src/
│       ├── lib/
│       │   ├── api-error.ts
│       │   ├── proxy-key.ts
│       │   └── request-context.ts
│       └── routes/
│           ├── proxy.ts
│           ├── passthrough.ts
│           └── providers/chat-completions/
│               ├── index.ts
│               ├── catalog.ts
│               ├── request.ts
│               ├── openai.ts
│               ├── anthropic.ts
│               └── gemini.ts
└── status-page/
    └── src/
```

### 关键职责

- `routes/proxy.ts`
  只保留统一入口本身：记录请求、解析目标 provider、调用 forwarder。
- `routes/providers/chat-completions/catalog.ts`
  维护统一模型列表。
- `routes/providers/chat-completions/request.ts`
  做模型校验、provider 解析、凭证解析。
- `routes/providers/chat-completions/{openai,anthropic,gemini}.ts`
  各 provider 的实际转发逻辑。
- `routes/providers/chat-completions/index.ts`
  provider registry，`proxy.ts` 只从这里拿 forwarder。

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

但没有先启用 Replit AI provider 集成，那么最容易遇到的是 provider 相关 503，而不是启动报错。

常见表现：

- 统一聊天入口会报 `Provider credentials for '<provider>' are not configured`
- 原生透传入口会报 `<PROVIDER> integration not configured`

这通常不是代码坏了，而是当前 Replit 项目还没有把对应 provider 的 `AI_INTEGRATIONS_*` 环境变量注入进来。

### 当前约束

- 不要在 `proxy.ts` 里重新堆回 provider 细节。
- 新增 provider 时，优先新增 provider 模块和 registry 映射，不要把分支继续堆进主路由。
- Anthropic 的 assistant prefill 仍然在本地先拦截，不等上游返回。
