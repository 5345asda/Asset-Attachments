# AI Proxy Gateway

这个仓库是一个给 Replit 用的单入口 AI 原生接口代理单仓库。

- 对外支持 `/api/anthropic/*`
- 对外支持 `/api/gemini/*`
- 对外支持 `/api/openrouter/*`

## 只看这几个文件

- 根目录 `.replit`
- 根目录 `package.json`
- [replit.md](./replit.md)

部署与结构判断以当前根目录 `.replit`、根目录 `package.json` 和 `replit.md` 为准。

## 当前结构

- `artifacts/api-server`
- `artifacts/status-page`
- 当前仓库通过 Git 导入到 Replit，直接以仓库根目录作为项目根目录
- 单入口部署，前端静态资源由后端统一托管
- Anthropic 走 Replit integration
- Gemini 也走 Replit integration
- OpenRouter 也可走 Replit integration，必要时回退 direct secret

## 部署命令

- Build command: `pnpm run build:deploy`
- Run command: `pnpm start`

## Proxy Key

- 默认鉴权 key 现在是固定值，不会因为重启、重新部署或容器切换而变化：
  `sk-proxy-6f2d0c9a47b13e8d5f71a2c46be93d07f8c1a54e692db3fc`
- 如需覆盖，直接设置环境变量 `PROXY_API_KEY`
- `GET /api/proxy-info` 会返回当前实际生效的 proxy key

## API 概览

| 路径 | 认证 | 说明 |
|------|------|------|
| `GET /api/healthz` | 否 | 健康检查 |
| `GET /api/proxy-info` | 否 | 返回当前 Proxy Key 和 provider 信息 |
| `GET /api/anthropic/v1/models` | 否 | 返回 Claude 模型列表 |
| `POST /api/anthropic/v1/messages` | 是 | Anthropic 原生 messages 接口 |
| `GET /api/gemini/v1beta/models` | 否 | 返回 Gemini 模型列表 |
| `POST /api/gemini/v1beta/models/{model}:generateContent` | 是 | Gemini 原生 `generateContent` 接口 |
| `POST /api/gemini/v1beta/models/{model}:streamGenerateContent?alt=sse` | 是 | Gemini 原生流式接口 |
| `GET /api/openrouter/v1/models` | 否 | 返回 OpenRouter OpenAI 兼容模型列表 |
| `POST /api/openrouter/v1/chat/completions` | 是 | OpenRouter OpenAI 兼容 chat completions 接口 |
