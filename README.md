# AI Proxy Gateway

这个仓库是一个给 Replit 用的单入口 AI 原生接口代理单仓库。

- 对外支持 `/api/anthropic/*`
- 对外支持 `/api/gemini/*`
- 对外支持 `/api/openrouter/*`
- 对外支持 `/api/openai/*`

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

- 公开 `/api/*` 代理现在必须显式设置环境变量 `PROXY_API_KEY`
- 不再保留仓库内硬编码默认 key
- `GET /api/proxy-info` 只返回 provider 状态和传输参数，不再公开返回 live proxy key

## Internal Redis

- 内部运行态 Redis 配置从环境变量读取，不写死在仓库里
- 优先使用 `REDIS_URL` + `REDIS_KEY`
- 也兼容 `REDIS_URL` + `REDIS_TOKEN`
- 如接 Upstash REST，也兼容 `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
- 当前只在服务端内部读取，不通过公开路由返回

## Internal Runs

- 内部执行器已经实现为 `GET /internal/healthz`、`POST /internal/runs`、`POST /internal/runs/:id/cancel`
- 内部鉴权 token 从环境变量 `INTERNAL_RUNS_TOKEN` 读取
- 内部执行器 Redis 配置从环境变量 `RUN_REDIS_URL`、`RUN_REDIS_USERNAME`、`RUN_REDIS_PASSWORD` 读取
- 其他可选调优项也都走环境变量：`RUN_REDIS_KEY_PREFIX`、`RUN_REDIS_CONNECT_TIMEOUT_MS`、`RUN_REDIS_TLS_CA_PEM_B64`、`RUN_WORKER_CONCURRENCY`、`RUN_EVENTS_BATCH_MS`、`RUN_EVENTS_BATCH_BYTES`、`RUN_HEARTBEAT_INTERVAL_MS`、`RUN_CANCEL_POLL_MS`、`RUN_RESULT_TTL_SECONDS`
- `/internal/healthz` 只暴露配置状态和 worker 概况，不返回 token、Redis URL 或密码
- 内部 run 现在会把状态、流式事件、终态结果、错误和取消标记持久化到 Redis
- 详细接口文档见 [docs/internal-runs-api.md](./docs/internal-runs-api.md)

## API 概览

| 路径 | 认证 | 说明 |
|------|------|------|
| `GET /api/healthz` | 否 | 健康检查 |
| `GET /api/proxy-info` | 否 | 返回 provider 信息和传输参数 |
| `GET /api/anthropic/v1/models` | 否 | 返回 Claude 模型列表 |
| `POST /api/anthropic/v1/messages` | 是 | Anthropic 原生 messages 接口 |
| `GET /api/gemini/v1beta/models` | 否 | 返回 Gemini 模型列表 |
| `POST /api/gemini/v1beta/models/{model}:generateContent` | 是 | Gemini 原生 `generateContent` 接口 |
| `POST /api/gemini/v1beta/models/{model}:streamGenerateContent?alt=sse` | 是 | Gemini 原生流式接口 |
| `GET /api/openrouter/v1/models` | 否 | 返回 OpenRouter OpenAI 兼容模型列表 |
| `POST /api/openrouter/v1/chat/completions` | 是 | OpenRouter OpenAI 兼容 chat completions 接口 |
| `GET /api/openai/v1/models` | 否 | 返回 OpenAI 模型列表 |
| `POST /api/openai/v1/chat/completions` | 是 | OpenAI chat completions 接口 |
| `POST /api/openai/v1/responses` | 是 | OpenAI responses 接口 |
