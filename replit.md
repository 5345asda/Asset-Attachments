# Workspace

这个文件是给 Replit AI 看的。按下面执行，不要自己重组项目。

## 先读这个

- 根目录 `.replit` 是唯一部署入口。
- 根目录 `package.json` 的 `dev` / `build` / `start` 是唯一需要执行的脚本。
- 参与部署的目录只有 `artifacts/api-server` 和 `artifacts/status-page`。
- 最终对外是单入口：`/` 是状态页，`/api/*` 是服务端接口。
- 不要先 `git clone` 到临时目录再复制文件。
- 不要把前后端拆成两个独立公开服务。
- 不要提交 Replit 自动生成的 `.replit-artifact` 元数据。

## 直接部署步骤

1. 直接导入这个 GitHub 仓库到当前 Replit 项目。
2. 先启用当前项目的 Anthropic integration。
3. 执行 `pnpm install`。
4. 运行 `pnpm dev`。
5. 发布时使用 build=`pnpm run build`，run=`pnpm start`。

## 必要环境变量

这些变量通常由 Replit AI Integrations 注入：

- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY`

额外可选：

- `PROXY_API_KEY`
- `TOKEN_MARKUP`
- `PORT`

## 最常见的坑

- 服务能启动，但页面显示 `Setup Required`：当前 Replit 项目还没启用 Anthropic integration。
- 源码已经更新，运行时还是旧行为：你还在跑旧的 `dist`，先执行 `pnpm run build`。
- 想手工改路径、端口、preview 拓扑：不要改，仓库已经固定成根目录单入口部署。

## 验证

至少跑这两条：

```bash
pnpm --filter @workspace/scripts run test:replit-template
pnpm run build
```
