import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        reject(new Error("Failed to reserve a local TCP port."));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });

    server.on("error", reject);
  });
}

test("proxy key file stays under artifacts/api-server/.data", async () => {
  const previousProxyKey = process.env.PROXY_API_KEY;
  process.env.PROXY_API_KEY = "sk-proxy-test";

  try {
    const proxyKeyModule = await import(
      "../../artifacts/api-server/src/lib/proxy-key.ts"
    ) as {
      PROXY_KEY_FILE: string;
    };

    assert.equal(
      proxyKeyModule.PROXY_KEY_FILE,
      path.resolve(repoRoot, "artifacts", "api-server", ".data", "proxy-key"),
    );
  } finally {
    if (previousProxyKey === undefined) {
      delete process.env.PROXY_API_KEY;
    } else {
      process.env.PROXY_API_KEY = previousProxyKey;
    }
  }
});

test("api-server dev script starts a local server", async (t) => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["./artifacts/api-server/dev.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      PROXY_API_KEY: "sk-proxy-test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  t.after(async () => {
    if (child.exitCode !== null) {
      return;
    }

    child.kill();

    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    });
  });

  let output = "";

  const started = await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for api-server dev to start.\n${output}`));
    }, 20000);

    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (
        output.includes("Provider integration status")
        && output.includes("Server listening")
      ) {
        clearTimeout(timer);
        resolve();
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`api-server dev script exited before startup. code=${code} signal=${signal}\n${output}`));
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  await started;

  const health = await fetch(`http://127.0.0.1:${port}/api/healthz`);
  assert.equal(health.status, 200);
});

test("proxy-info exposes Anthropic integration readiness for deployment checks", async () => {
  const previousBaseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  const previousApiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  const previousProxyKey = process.env.PROXY_API_KEY;
  const port = await getFreePort();

  delete process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  delete process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  process.env.PROXY_API_KEY = "sk-proxy-test";

  try {
    const { default: app } = await import("../../artifacts/api-server/src/app.ts");
    const server = app.listen(port);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/proxy-info`);
      assert.equal(response.status, 200);

      const body = await response.json() as {
        ready?: boolean;
        integrations?: {
          anthropic?: {
            configured?: boolean;
          };
        };
      };

      assert.equal(body.ready, false);
      assert.equal(body.integrations?.anthropic?.configured, false);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  } finally {
    if (previousBaseUrl === undefined) {
      delete process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
    } else {
      process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = previousBaseUrl;
    }

    if (previousApiKey === undefined) {
      delete process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
    } else {
      process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = previousApiKey;
    }

    if (previousProxyKey === undefined) {
      delete process.env.PROXY_API_KEY;
    } else {
      process.env.PROXY_API_KEY = previousProxyKey;
    }
  }
});
