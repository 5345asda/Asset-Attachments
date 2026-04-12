# AI Proxy Gateway

这个仓库是一个给 Replit 用的单入口 Anthropic 代理单仓库。

- 对外只支持 `/api/anthropic/*`
- 不再提供 `/api/v1/chat/completions`
- 不再提供其它 provider 路由

## 只看这几个文件

- 根目录 `.replit`
- 根目录 `package.json`
- [replit.md](D:/64服务器/Asset-Attachments/replit.md)

部署时不要根据历史 README、旧 prompt 或旧 artifact 说明推断结构。

## 当前结构

- `artifacts/api-server`
- `artifacts/status-page`
- 单入口部署，前端静态资源由后端统一托管
- 只依赖 Anthropic integration

## 部署命令

- Build command: `pnpm run build:deploy`
- Run command: `pnpm start`

## 两个发布包

- 常规包：`release/Asset-Attachments-replit-upload-20260412.zip`
  现在是 runtime-only 结构，只带 `package.json`、`server/`、`public/` 和 `REPLIT_UPLOAD_PROMPT.txt`，故意不包含根 `.replit`
- fast-start 包：`release/Asset-Attachments-replit-fast-start-20260412.zip`
  同样是 runtime-only 结构，但额外带根 `.replit` 和 `REPLIT_FAST_START_PROMPT.txt`，开箱即跑

重新生成发布包：

```bash
pnpm run pack:replit
```

## API 概览

| 路径 | 认证 | 说明 |
|------|------|------|
| `GET /api/healthz` | 否 | 健康检查 |
| `GET /api/proxy-info` | 否 | 返回当前 Proxy Key 和 provider 信息 |
| `GET /api/anthropic/v1/models` | 否 | 返回 Claude 模型列表 |
| `POST /api/anthropic/v1/messages` | 是 | Anthropic 原生 messages 接口 |
