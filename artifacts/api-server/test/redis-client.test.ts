import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";

function runRedisClientProbe(env: NodeJS.ProcessEnv): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  const script = [
    "import('./src/lib/redis-client.ts').then(async (module) => {",
    "  const timer = setTimeout(() => {",
    "    console.log('timed_out');",
    "    process.exit(124);",
    "  }, 1500);",
    "  try {",
    "    await module.getRedisRunStoreClient();",
    "    clearTimeout(timer);",
    "    console.log('resolved');",
    "    process.exit(0);",
    "  } catch (error) {",
    "    clearTimeout(timer);",
    "    console.log(`rejected:${error instanceof Error ? error.message : String(error)}`);",
    "    process.exit(0);",
    "  }",
    "}).catch((error) => {",
    "  console.error(error instanceof Error ? error.stack || error.message : String(error));",
    "  process.exit(1);",
    "});",
  ].join("");

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--eval", script], {
      cwd: path.resolve(process.cwd()),
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        stdout,
        stderr,
      });
    });
  });
}

test("getRedisRunStoreClient fails fast when Redis is unreachable", async () => {
  const result = await runRedisClientProbe({
    INTERNAL_RUNS_TOKEN: "internal-runs-token",
    RUN_REDIS_URL: "rediss://10.255.255.1:36479/0",
    RUN_REDIS_USERNAME: "aa-run",
    RUN_REDIS_PASSWORD: "password",
    RUN_REDIS_CONNECT_TIMEOUT_MS: "500",
  });

  assert.notEqual(
    result.code,
    124,
    `expected Redis connect to fail fast, but probe timed out.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.match(
    result.stdout,
    /rejected:/,
    `expected Redis connect failure to reject, got:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
});
