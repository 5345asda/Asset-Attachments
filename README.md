# AI Proxy Gateway

这个仓库是一个给 Replit 用的 Anthropic 原生代理单仓库。

- 对外只支持 `/api/anthropic/*`
- 不再提供 `/api/v1/chat/completions`
- 不再提供 OpenAI / Gemini / OpenRouter 路由

## Replit 直接部署

最简单的方式就是直接导入并部署，不要中转复制：

1. 在 Replit 里直接导入这个 GitHub 仓库。
2. 先启用当前项目的 Anthropic integration。
3. 执行 `pnpm install`。
4. 点 Run，根目录 `.replit` 会跑 `pnpm dev`。
5. 点 Deploy，根目录 `.replit` 会用 build=`pnpm run build`、run=`pnpm start`。

## 一轮对话版

如果你想把这段话直接发给 Replit AI，复制下面这段，不要再自己解释：

```text
这是一个单入口 Replit Anthropic 模板。不要重组项目，不要新建 workflow，不要拆分前后端，不要修改业务代码来迁就 Deploy 面板。直接按根目录 .replit 执行：先启用 Anthropic integration，然后 pnpm install；Run 用 pnpm dev；Deploy 面板固定填写 Build command: pnpm run build、Run command: pnpm start；部署后只检查 / 和 /api/healthz。
```

如果你是手工填 Deploy 面板，直接填这两个值：

- Build command: `pnpm run build`
- Run command: `pnpm start`

不要做这些事：

- 不要先 clone 到临时目录再把文件 copy 到另一个 Replit 项目。
- 不要把这个仓库导入到一个已经带历史 artifact workflow 的旧 Replit 项目里继续修补；最稳的做法是新建一个干净 Replit 再导入。
- 不要把 `artifacts/status-page` 和 `artifacts/api-server` 当成两个独立应用重新部署。
- 不要忽略根目录 `.replit`，它就是这个仓库的唯一部署入口。
- 不要把 Replit 自动生成的 `.replit-artifact` 元数据重新提交回仓库。
- 不要把仓库里的测试、规划文件或历史实验目录当成部署路径的一部分。
- 不要为了修复 Deploy 面板里的空命令去改业务代码、路由或静态资源路径。

## 部署真相源

- 根目录 `.replit` 就是唯一的部署入口
- 根目录 `package.json` 里的 `dev` / `build` / `start` 就是唯一要执行的脚本
- 参与部署的 artifact 只有 `artifacts/api-server` 和 `artifacts/status-page`
- 状态页最终由统一入口托管：`/` 是页面，`/api/*` 是服务端接口

## 快速开始

首次在新的 Replit 项目里运行前，必须先启用 Anthropic 集成。仓库自身不会生成这些环境变量。

需要的变量：

- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY`

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

## 生产启动

```bash
pnpm run build
pnpm start
```

`pnpm start` 只启动已有构建产物，不会自动重建源码。导入新代码、`git pull`、或手工替换文件后，要先重新执行 `pnpm run build`。

## API 概览

| 路径 | 认证 | 说明 |
|------|------|------|
| `GET /api/healthz` | 否 | 健康检查 |
| `GET /api/proxy-info` | 否 | 返回当前 Proxy Key 和 provider 信息 |
| `GET /api/anthropic/v1/models` | 是 | 返回 Claude 模型列表 |
| `POST /api/anthropic/v1/messages` | 是 | Anthropic 原生 messages 接口 |

## 关键环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PROXY_API_KEY` | 固定代理 Key | 自动生成 |
| `TOKEN_MARKUP` | Token 计费倍率 | `1.0` |
| `PORT` | API 服务端口 | 由运行环境分配 |

Anthropic 凭证默认走 Replit 注入的环境变量：

- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY`

Proxy Key 查找顺序：

1. `PROXY_API_KEY`
2. `artifacts/api-server/.data/proxy-key`
3. 首次启动自动生成

## 排错

- 每个请求都会返回或透传 `x-request-id`，查日志时优先用它串联请求。
- 新项目最常见的问题不是安装失败，而是没先启用 Anthropic integration，表现为运行时 503 或页面显示 `Setup Required`。
- 如果源码里明明有接口，运行时却还是旧行为，优先怀疑旧 `dist` 产物没有重建，先执行 `pnpm run build`。
- 如果部署界面还残留旧 workflow、旧 artifact 服务，或者 Run command 仍然是空的，优先判断当前 Replit 是历史项目；这种情况不要继续修，直接新建 Replit 并重新导入仓库。

## 部署完成后最少验收

- 根路径 `/` 能打开状态页
- `GET /api/healthz` 返回成功
- Deploy 里仍然是 build=`pnpm run build`、run=`pnpm start`
