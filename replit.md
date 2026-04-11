# Workspace

这个文件是给 Replit AI 看的。按下面执行，不要自己重组项目。

## 先读这个

- 根目录 `.replit` 是唯一部署入口。
- 根目录 `package.json` 的 `dev` / `build` / `start` 是唯一需要执行的脚本。
- 参与部署的目录只有 `artifacts/api-server` 和 `artifacts/status-page`。
- 最终对外是单入口：`/` 是状态页，`/api/*` 是服务端接口。
- 如果当前 Replit 不是全新项目，或者里面已经存在旧的 artifact workflow / 旧服务预览，不要继续修补，直接新建一个 Replit 再导入这个仓库。
- 不要先 `git clone` 到临时目录再复制文件。
- 不要把前后端拆成两个独立公开服务。
- 不要提交 Replit 自动生成的 `.replit-artifact` 元数据。

## 直接部署步骤

1. 直接导入这个 GitHub 仓库到当前 Replit 项目。
2. 先启用当前项目的 Anthropic integration。
3. 执行 `pnpm install`。
4. 运行 `pnpm dev`。
5. 发布时使用 build=`pnpm run build`，run=`pnpm start`。

## 遇到旧项目时怎么处理

- 如果你看到已有的 API Server workflow、mockup workflow、旧 preview 端口或历史 artifact 配置，不要尝试在原项目里覆盖式修复。
- 不要先 `git clone` 到 `/tmp` 再 `cp` 回工作区。
- 不要手工拼 `STATIC_DIR=$PWD/...` 这种项目级补丁。
- 正确做法只有一个：新建干净 Replit，直接导入仓库，然后按上面的 5 步执行。

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
- 部署界面仍然显示旧 workflow 或空的 Run command：通常说明你导入的是历史 Replit 项目，不是干净的新项目，直接新建并重新导入。

## 验证

至少跑这两条：

```bash
pnpm --filter @workspace/scripts run test:replit-template
pnpm run build
```
