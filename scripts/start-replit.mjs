import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const apiEntry = path.resolve(rootDir, "artifacts", "api-server", "dist", "index.mjs");
const port = process.env.PORT || "3000";

function resolveStaticDir() {
  if (!process.env.STATIC_DIR) {
    return path.resolve(rootDir, "artifacts", "status-page", "dist", "public");
  }

  return path.isAbsolute(process.env.STATIC_DIR)
    ? process.env.STATIC_DIR
    : path.resolve(rootDir, process.env.STATIC_DIR);
}

const staticDir = resolveStaticDir();
const missingPaths = [
  !existsSync(apiEntry) ? apiEntry : null,
  !existsSync(staticDir) ? staticDir : null,
].filter(Boolean);

if (missingPaths.length > 0) {
  console.error("Missing build output required for the unified Replit start flow.");
  console.error("Run `pnpm run build` before `pnpm start`.");
  for (const missingPath of missingPaths) {
    console.error(`- ${missingPath}`);
  }
  process.exit(1);
}

const child = spawn(
  process.execPath,
  ["--enable-source-maps", apiEntry],
  {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || "production",
      PORT: port,
      STATIC_DIR: staticDir,
    },
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
