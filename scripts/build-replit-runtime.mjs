import { spawnSync } from "node:child_process";
import {
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = "server";
const PUBLIC_DIR = "public";
const ASSET_PATH_PATTERN = /(?:src|href)="(\/assets\/[^"]+)"/g;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const releaseRoot = path.join(repoRoot, "release");
const apiDistDir = path.join(repoRoot, "artifacts", "api-server", "dist");
const publicDistDir = path.join(repoRoot, "artifacts", "status-page", "dist", "public");
const verifyScript = path.join(scriptDir, "verify-replit.mjs");
const startScript = path.join(scriptDir, "start-replit.mjs");
const dateStamp = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
}).format(new Date()).replaceAll("-", "");
const runtimePackage = {
  name: "asset-attachments-replit-runtime",
  version: "0.0.0",
  private: true,
  type: "module",
  scripts: {
    dev: "pnpm start",
    start: "node ./server/start.mjs",
    "build:deploy": "node -e \"console.log('Runtime package already built.')\"",
    "verify:replit": "node ./server/verify-replit.mjs",
  },
};
const sharedFiles = {
  "package.json": JSON.stringify(runtimePackage, null, 2) + "\n",
  "README.md": `# Replit Runtime Package

这个发布包已经是最小运行时结构，不需要理解原始 monorepo。

- \`server/\`: 已构建后端入口
- \`public/\`: 已构建状态页静态资源
- \`package.json\`: Replit 只需要执行的脚本

首次启动：

\`\`\`bash
pnpm start
pnpm run verify:replit
\`\`\`

Deploy:

- Build command: \`pnpm run build:deploy\`
- Run command: \`pnpm start\`
- Default Proxy Key: \`sk-proxy-6f2d0c9a47b13e8d5f71a2c46be93d07f8c1a54e692db3fc\`
- To override, set \`PROXY_API_KEY\`
- Anthropic: enable Replit integration
- Gemini: enable Replit integration
- If you need both providers, enable both Replit integrations
`,
  "replit.md": `# Replit Runtime

只看 \`package.json\`，不要把这个包当成 monorepo 重新拆分。

执行顺序：

1. 按需分别配置 provider：Anthropic 启用 Replit integration；Gemini 也启用 Replit integration。
2. 运行 \`pnpm install\`。
3. 运行 \`pnpm start\`。
4. 运行 \`pnpm run verify:replit\`。

补充：

- 默认 Proxy Key 已固定，不会因为重启变化
- 需要自定义时再设置 \`PROXY_API_KEY\`

验收必须通过：

- \`GET /\` 返回状态页 HTML
- \`GET /api/healthz\` 返回 JSON
- \`GET /api/proxy-info\` 返回 JSON 且至少一个 provider 已配置
- 已启用 Anthropic 时，\`GET /api/anthropic/v1/models\` 返回 JSON 模型列表
- 已启用 Gemini integration 时，\`GET /api/gemini/v1beta/models\` 返回 JSON 模型列表
`,
};
const releaseVariants = [
  {
    slug: "replit-upload",
    promptFileName: "REPLIT_UPLOAD_PROMPT.txt",
    promptTitle: "这是一个最小化的 Replit runtime 上传包。",
    includeReplit: false,
  },
  {
    slug: "replit-fast-start",
    promptFileName: "REPLIT_FAST_START_PROMPT.txt",
    promptTitle: "这是一个已经预构建好的 Replit runtime 包。",
    includeReplit: true,
  },
];

function runtimeReplit() {
  return `modules = ["nodejs-24"]
run = "pnpm start"

[deployment]
build = "pnpm run build:deploy"
run = "pnpm start"
router = "application"
deploymentTarget = "autoscale"

[workflows]
runButton = "Project"

[gitHubImport]
requiredFiles = [".replit", "package.json", "server/start.mjs"]

[[ports]]
localPort = 3000
externalPort = 80
`;
}

function releasePrompt(title) {
  return `${title}

不要把它当 monorepo，不要重组目录，不要新建 workflow 或 artifact。

执行：
1. 解压到 Replit 项目根目录。
2. 按需分别配置 provider：Anthropic 启用 Replit integration；Gemini 也启用 Replit integration。
3. 运行 \`pnpm install\`。
4. 运行 \`pnpm start\`。
5. 运行 \`pnpm run verify:replit\`。

Deploy 固定填写：
- Build command: \`pnpm run build:deploy\`
- Run command: \`pnpm start\`
`;
}

async function writeTextFile(targetDir, name, content) {
  await writeFile(path.join(targetDir, name), content, "utf8");
}

function getReleaseDir(slug) {
  return path.join(releaseRoot, `Asset-Attachments-${slug}`);
}

function getReleaseZipPath(slug) {
  return path.join(releaseRoot, `Asset-Attachments-${slug}-${dateStamp}.zip`);
}

function escapePowerShellLiteral(value) {
  return value.replaceAll("'", "''");
}

function zipDirectory(sourceDir, zipPath) {
  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName 'System.IO.Compression.FileSystem'",
      `if (Test-Path -LiteralPath '${escapePowerShellLiteral(zipPath)}') { Remove-Item -LiteralPath '${escapePowerShellLiteral(zipPath)}' -Force }`,
      `[System.IO.Compression.ZipFile]::CreateFromDirectory('${escapePowerShellLiteral(sourceDir)}', '${escapePowerShellLiteral(zipPath)}', [System.IO.Compression.CompressionLevel]::Optimal, $false)`,
    ].join("; ");

    const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
      cwd: repoRoot,
      stdio: "inherit",
    });

    if (result.status !== 0) {
      throw new Error(`Failed to create zip: ${zipPath}`);
    }

    return;
  }

  const result = spawnSync("zip", ["-qry", zipPath, "."], {
    cwd: sourceDir,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`Failed to create zip: ${zipPath}`);
  }
}

async function ensureBuildOutputs() {
  for (const file of [path.join(apiDistDir, "index.mjs"), path.join(publicDistDir, "index.html")]) {
    await readFile(file);
  }
}

async function writeSharedFiles(targetDir) {
  for (const [name, content] of Object.entries(sharedFiles)) {
    await writeTextFile(targetDir, name, content);
  }
}

async function copyServerRuntime(targetDir) {
  const serverDir = path.join(targetDir, SERVER_DIR);

  for (const entry of await readdir(apiDistDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".mjs")) {
      await copyFile(
        path.join(apiDistDir, entry.name),
        path.join(serverDir, entry.name),
      );
    }
  }
}

async function copyPublicRuntime(targetDir) {
  const publicDir = path.join(targetDir, PUBLIC_DIR);

  for (const entry of await readdir(publicDistDir, { withFileTypes: true })) {
    if (entry.name === "assets") {
      continue;
    }

    const sourcePath = path.join(publicDistDir, entry.name);
    const targetPath = path.join(publicDir, entry.name);
    if (entry.isDirectory()) {
      await cp(sourcePath, targetPath, { recursive: true });
    } else {
      await copyFile(sourcePath, targetPath);
    }
  }

  const html = await readFile(path.join(publicDistDir, "index.html"), "utf8");
  const assetPaths = new Set(
    [...html.matchAll(ASSET_PATH_PATTERN)].map((match) =>
      match[1].replace(/^\//, ""),
    ),
  );

  for (const assetPath of assetPaths) {
    const targetPath = path.join(publicDir, assetPath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(path.join(publicDistDir, assetPath), targetPath);
  }
}

async function prepareReleaseDir({ slug, includeReplit, promptFileName, promptTitle }) {
  const targetDir = getReleaseDir(slug);
  const serverDir = path.join(targetDir, SERVER_DIR);
  const publicDir = path.join(targetDir, PUBLIC_DIR);

  await rm(targetDir, { recursive: true, force: true });
  await mkdir(serverDir, { recursive: true });
  await mkdir(publicDir, { recursive: true });

  await writeSharedFiles(targetDir);
  await writeTextFile(targetDir, promptFileName, releasePrompt(promptTitle));

  if (includeReplit) {
    await writeTextFile(targetDir, ".replit", runtimeReplit());
  }

  await copyFile(startScript, path.join(serverDir, "start.mjs"));
  await copyFile(verifyScript, path.join(serverDir, "verify-replit.mjs"));
  await copyServerRuntime(targetDir);
  await copyPublicRuntime(targetDir);
}

async function main() {
  await ensureBuildOutputs();
  await mkdir(releaseRoot, { recursive: true });

  for (const variant of releaseVariants) {
    await prepareReleaseDir(variant);
    zipDirectory(getReleaseDir(variant.slug), getReleaseZipPath(variant.slug));
  }

  console.log(`Built runtime-only Replit release packages for ${dateStamp}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
