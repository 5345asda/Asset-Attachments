# AI Proxy Gateway

OpenAI 兼容的多模型 AI 代理网关，通过 Replit AI Integrations 将请求路由至 Anthropic、OpenAI 和 Google Gemini，附带 React 状态页面。

## 架构

```
客户端 (OpenAI SDK / curl)
      │  Authorization: Bearer <proxy-key>
      ▼
┌─────────────────────────────┐
│   Express API Server        │
│   /api/v1/chat/completions  │
│   /api/anthropic/*          │
│   /api/gemini/*             │
└──────────┬──────────────────┘
           │  按 model 前缀路由
     ┌─────┼──────┐
     ▼     ▼      ▼
Anthropic OpenAI Gemini
(via Replit AI Integrations — 无需自备 API Key)
```

## 快速开始

### 1. 获取代理地址和 Key

部署后访问状态页面（根路径 `/`），页面会显示：
- Base URL（如 `https://xxx.replit.app/api/v1`）
- Proxy Key（首次启动自动生成，重启/重部署保持不变）

### 2. 使用 OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://your-app.replit.app/api/v1",
    api_key="sk-proxy-xxxxx",  # 从状态页面获取
)

# 使用 OpenAI 模型
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}],
)

# 使用 Anthropic 模型（前缀 claude-）
response = client.chat.completions.create(
    model="claude-opus-4-5",
    messages=[{"role": "user", "content": "Hello!"}],
)

# 使用 Gemini 模型（前缀 gemini-）
response = client.chat.completions.create(
    model="gemini-2.5-flash",
    messages=[{"role": "user", "content": "Hello!"}],
)
```

### 3. 使用 curl

```bash
BASE_URL="https://your-app.replit.app/api/v1"
PROXY_KEY="sk-proxy-xxxxx"

curl "$BASE_URL/chat/completions" \
  -H "Authorization: Bearer $PROXY_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello!"}]}'
```

## API 端点

| 端点 | 需要认证 | 说明 |
|------|----------|------|
| `GET /api/healthz` | 否 | 健康检查 |
| `GET /api/proxy-info` | 否 | 返回 Key 和已配置的 Provider |
| `GET /api/v1/models` | 是 | 列出所有可用模型 |
| `POST /api/v1/chat/completions` | 是 | 统一聊天接口（自动路由） |
| `POST /api/anthropic/*` | 是 | Anthropic 原生格式透传 |
| `POST /api/gemini/*` | 是 | Gemini 原生格式透传 |

### 模型路由规则

| model 前缀 | 路由至 |
|------------|--------|
| `claude-` | Anthropic |
| `gemini-` | Gemini |
| 其他 | OpenAI |

## 认证

在请求头中传入 Proxy Key：

```
Authorization: Bearer sk-proxy-xxxxx
# 或
x-api-key: sk-proxy-xxxxx
```

## Proxy Key 持久化

- **首次部署**：服务器自动生成 Key，写入 `artifacts/api-server/.data/proxy-key`（此文件已加入 `.gitignore`，不会提交到代码库）
- **后续重启/重部署**：读取已有文件，Key 保持不变
- **容器完全重置后**：如需保持同一 Key，可将其值存为 Replit Secret `PROXY_API_KEY`（Secret 优先级高于文件）

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PROXY_API_KEY` | 固定代理 Key（可选） | 自动生成 |
| `TOKEN_MARKUP` | Token 计费倍率 | `1.0` |
| `PORT` | API 服务端口 | Replit 自动分配 |

以上 AI 相关变量（`AI_INTEGRATIONS_*`）由 Replit 平台自动注入，无需手动配置。

## 本地开发

```bash
# 安装依赖
pnpm install

# Replit 单入口模式（先构建状态页，再由 API 服务统一托管）
pnpm dev

# 分离调试：先启动 API 服务，再启动状态页
pnpm --filter @workspace/api-server run dev
VITE_API_PROXY_TARGET=http://127.0.0.1:8080 \
pnpm --filter @workspace/status-page run dev
```

- `pnpm start`：使用已经构建好的产物启动统一入口，要求先执行过 `pnpm run build`
- Replit `Run` 按钮：现在直接执行 `pnpm dev`
- Replit Deployment：现在显式使用 `build = "pnpm run build"` 与 `run = "pnpm start"`
- `VITE_API_ORIGIN`：如果前端需要直接请求另一个 API 域名，可显式指定完整 Origin
- `VITE_API_PROXY_TARGET`：本地分离调试时，让 Vite 将 `/api/*` 代理到 API 服务

## 项目结构

```
artifacts/
├── api-server/          # Express 代理服务
│   └── src/
│       ├── routes/      # 路由：health / proxy / passthrough
│       └── lib/         # proxy-key、format 转换（Anthropic/Gemini）
└── status-page/         # React 状态页面
    └── src/
        └── pages/       # 状态展示、Key 复制、代码示例
```
