# Workspace

这个文件是给 Replit AI 看的。按下面执行，不要自己重组项目。

## 一轮对话优先

如果你只能做一轮对话，就直接执行下面这段，不要自己推断其它部署拓扑：

```text
这是一个单入口 Replit 原生接口模板。只看根目录 .replit 和根 package.json，不要根据 README、旧 prompt、历史 artifact 说明推断部署方式。解压前如发现旧残留，先在项目根目录执行 rm -rf artifacts/mockup-sandbox artifacts/api-portal artifacts/api-server/.replit-artifact artifacts/status-page/.replit-artifact；解压后目标只保留 artifacts/api-server 和 artifacts/status-page。普通 upload 包故意不覆盖根 .replit；如果平台阻止覆盖根 .replit，不要停下来，只确认当前 .replit 满足 run=pnpm dev、deployment build=pnpm run build:deploy、deployment run=pnpm start。不要拆分前后端，不要新建、修改或切换 workflow、artifact 或临时脚本，不要修改业务代码来迁就 Deploy 面板。Anthropic 需要启用 Replit integration；Gemini 也需要启用 Replit integration；如果项目启用了 OpenRouter integration，也优先走 Replit 内置接入，不要额外要求用户填写 OpenRouter API Key。然后执行 pnpm install。Run 用 pnpm dev。Deploy 面板固定填写：Build command: pnpm run build:deploy；Run command: pnpm start。部署后检查 /、/api/healthz、/api/proxy-info，并按已配置 provider 继续检查 /api/anthropic/v1/models、/api/gemini/v1beta/models 或 /api/openrouter/v1/models；其中 models 路由必须返回 JSON，不能返回 HTML 或鉴权错误。
```

Deploy 面板固定填写：

- Build command: `pnpm run build:deploy`
- Run command: `pnpm start`

## 只看这几个事实

- 根目录 `.replit` 是唯一部署入口。
- 根目录 `package.json` 的 `dev` / `build` / `start` 是唯一需要执行的脚本。
- 解压后目标结构只保留 `artifacts/api-server` 和 `artifacts/status-page`。
- 最终对外只有一个入口：`/` 是状态页，`/api/*` 是服务端接口。
- 默认 Proxy Key 已固定，不会因为重启变化；需要自定义时再设置 `PROXY_API_KEY`。
- 不要为了修复空的 Run command 去改应用代码。
- 不要为了修复发布配置去新增 workflow、artifact 或临时脚本。

## 少读文件

- 先读顺序固定：根目录 `.replit` -> 根目录 `package.json` -> 当前 `replit.md`。
- 不要读 `lib/api-client-react/src/generated/` 和 `lib/api-zod/src/generated/`，除非你正在修生成代码或类型生成问题。
- 不要先展开阅读测试文件，除非部署验收失败后需要定位问题。

## 执行顺序

1. 如果是 zip 上传，先在项目根目录清理旧残留：
   `rm -rf artifacts/mockup-sandbox artifacts/api-portal artifacts/api-server/.replit-artifact artifacts/status-page/.replit-artifact`
2. 把 zip 解压到当前 Replit 项目根目录。
3. 按需分别配置 provider：Anthropic 启用 Replit integration；Gemini 也启用 Replit integration。
4. 执行 `pnpm install`。
5. Run 使用 `pnpm dev`。
6. Publish / Deploy 使用 Autoscale，Build command=`pnpm run build:deploy`，Run command=`pnpm start`。

## 端口口径

- 应用监听 `PORT`，开发默认按 `3000` 理解。
- 本地进程验证优先请求实际监听端口，例如 `http://127.0.0.1:$PORT/...`。
- 对外验收先看公开域名上的 `/`、`/api/healthz`、`/api/proxy-info`，再根据实际配置去看 `/api/anthropic/v1/models`、`/api/gemini/v1beta/models` 或 `/api/openrouter/v1/models`，不要混用本地端口和公网路由概念。

## 不要做

- 不要把前后端拆成两个独立公开服务。
- 不要根据旧提示词里的历史结构或旧路由改当前仓库。
- 不要提交 Replit 自动生成的 `.replit-artifact` 元数据。
- 不要先 `git clone` 到临时目录再复制回当前项目。
- 不要在带旧 workflow 的历史 Replit 项目里继续修补；那种情况直接新建干净项目再导入。

## 部署验收

- 根路径 `/` 能打开状态页。
- `GET /api/healthz` 返回成功。
- `GET /api/proxy-info` 返回 JSON，并至少有一个 provider 的 `configured=true`。
- 如果启用了 Anthropic，`GET /api/anthropic/v1/models` 返回 JSON 模型列表，不是 HTML，也不是 401。
- 如果启用了 Gemini integration，`GET /api/gemini/v1beta/models` 返回 JSON 模型列表，不是 HTML，也不是 401。
- 如果启用了 OpenRouter integration，`GET /api/openrouter/v1/models` 返回 JSON 模型列表，不是 HTML，也不是 401。
- 页面如果显示 `Setup Required`，优先判断当前项目是否既没有 Anthropic integration，也没有 Gemini integration。

如果需要补充验证，再跑这两条：

```bash
pnpm --filter @workspace/scripts run test:replit-template
pnpm run build
```
