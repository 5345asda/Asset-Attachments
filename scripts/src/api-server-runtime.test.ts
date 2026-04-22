import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

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

test("proxy key falls back to the fixed repo default when no env override is set", async () => {
  const previousProxyKey = process.env.PROXY_API_KEY;
  delete process.env.PROXY_API_KEY;

  try {
    const proxyKeyModule = await import(
      `${pathToFileURL(path.join(repoRoot, "artifacts", "api-server", "src", "lib", "proxy-key.ts")).href}?default-proxy-key-test=${Date.now()}`
    ) as {
      DEFAULT_PROXY_API_KEY: string;
      PROXY_API_KEY: string;
    };

    assert.equal(
      proxyKeyModule.DEFAULT_PROXY_API_KEY,
      "sk-proxy-6f2d0c9a47b13e8d5f71a2c46be93d07f8c1a54e692db3fc",
    );
    assert.equal(proxyKeyModule.PROXY_API_KEY, proxyKeyModule.DEFAULT_PROXY_API_KEY);
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

test("api-server dev script defaults to port 3000 when PORT is unset", async () => {
  const devScript = await readFile(path.join(repoRoot, "artifacts", "api-server", "dev.mjs"), "utf8");

  assert.match(devScript, /PORT:\s*process\.env\.PORT\s*\|\|\s*"3000"/);
  assert.doesNotMatch(devScript, /PORT:\s*process\.env\.PORT\s*\|\|\s*"8080"/);
});

test("proxy-info exposes Anthropic integration readiness for deployment checks", async () => {
  const previousBaseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  const previousApiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  const previousDirectBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const previousDirectApiKey = process.env.ANTHROPIC_API_KEY;
  const previousGeminiIntegrationBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const previousGeminiIntegrationApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const previousGeminiDirectBaseUrl = process.env.GEMINI_BASE_URL;
  const previousGeminiDirectApiKey = process.env.GEMINI_API_KEY;
  const previousOpenRouterIntegrationBaseUrl = process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL;
  const previousOpenRouterIntegrationApiKey = process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
  const previousOpenRouterDirectBaseUrl = process.env.OPENROUTER_BASE_URL;
  const previousOpenRouterDirectApiKey = process.env.OPENROUTER_API_KEY;
  const previousProxyKey = process.env.PROXY_API_KEY;
  const port = await getFreePort();

  delete process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  delete process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  delete process.env.GEMINI_BASE_URL;
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL;
  delete process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_BASE_URL;
  delete process.env.OPENROUTER_API_KEY;
  process.env.PROXY_API_KEY = "sk-proxy-test";

  try {
    const { default: app } = await import("../../artifacts/api-server/src/app.ts");
    const server = app.listen(port);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/proxy-info`);
      assert.equal(response.status, 200);

      const body = await response.json() as {
        ready?: boolean;
        providers?: string[];
        integrations?: {
          anthropic?: {
            configured?: boolean;
          };
          gemini?: {
            configured?: boolean;
          };
          openrouter?: {
            configured?: boolean;
          };
        };
      };

      assert.equal(body.ready, false);
      assert.ok(body.providers?.includes("openrouter"));
      assert.equal(body.integrations?.anthropic?.configured, false);
      assert.equal(body.integrations?.gemini?.configured, false);
      assert.equal(body.integrations?.openrouter?.configured, false);
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

    if (previousDirectBaseUrl === undefined) {
      delete process.env.ANTHROPIC_BASE_URL;
    } else {
      process.env.ANTHROPIC_BASE_URL = previousDirectBaseUrl;
    }

    if (previousDirectApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = previousDirectApiKey;
    }

    if (previousGeminiIntegrationBaseUrl === undefined) {
      delete process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
    } else {
      process.env.AI_INTEGRATIONS_GEMINI_BASE_URL = previousGeminiIntegrationBaseUrl;
    }

    if (previousGeminiIntegrationApiKey === undefined) {
      delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    } else {
      process.env.AI_INTEGRATIONS_GEMINI_API_KEY = previousGeminiIntegrationApiKey;
    }

    if (previousGeminiDirectBaseUrl === undefined) {
      delete process.env.GEMINI_BASE_URL;
    } else {
      process.env.GEMINI_BASE_URL = previousGeminiDirectBaseUrl;
    }

    if (previousGeminiDirectApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = previousGeminiDirectApiKey;
    }

    if (previousOpenRouterIntegrationBaseUrl === undefined) {
      delete process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL;
    } else {
      process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL = previousOpenRouterIntegrationBaseUrl;
    }

    if (previousOpenRouterIntegrationApiKey === undefined) {
      delete process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
    } else {
      process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY = previousOpenRouterIntegrationApiKey;
    }

    if (previousOpenRouterDirectBaseUrl === undefined) {
      delete process.env.OPENROUTER_BASE_URL;
    } else {
      process.env.OPENROUTER_BASE_URL = previousOpenRouterDirectBaseUrl;
    }

    if (previousOpenRouterDirectApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = previousOpenRouterDirectApiKey;
    }

    if (previousProxyKey === undefined) {
      delete process.env.PROXY_API_KEY;
    } else {
      process.env.PROXY_API_KEY = previousProxyKey;
    }
  }
});

test("proxy-info reports Anthropic ready when direct Anthropic secrets are provided", async () => {
  const previousBaseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  const previousApiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  const previousDirectBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const previousDirectApiKey = process.env.ANTHROPIC_API_KEY;
  const previousGeminiIntegrationBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const previousGeminiIntegrationApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const previousGeminiDirectBaseUrl = process.env.GEMINI_BASE_URL;
  const previousGeminiDirectApiKey = process.env.GEMINI_API_KEY;
  const previousOpenRouterIntegrationBaseUrl = process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL;
  const previousOpenRouterIntegrationApiKey = process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
  const previousOpenRouterDirectBaseUrl = process.env.OPENROUTER_BASE_URL;
  const previousOpenRouterDirectApiKey = process.env.OPENROUTER_API_KEY;
  const previousProxyKey = process.env.PROXY_API_KEY;
  const port = await getFreePort();

  delete process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  delete process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_BASE_URL = "https://anthropic.byok.test";
  process.env.ANTHROPIC_API_KEY = "anthropic-direct-test-key";
  delete process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  delete process.env.GEMINI_BASE_URL;
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL;
  delete process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_BASE_URL;
  delete process.env.OPENROUTER_API_KEY;
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
          gemini?: {
            configured?: boolean;
          };
          openrouter?: {
            configured?: boolean;
          };
        };
      };

      assert.equal(body.ready, true);
      assert.equal(body.integrations?.anthropic?.configured, true);
      assert.equal(body.integrations?.gemini?.configured, false);
      assert.equal(body.integrations?.openrouter?.configured, false);
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

    if (previousDirectBaseUrl === undefined) {
      delete process.env.ANTHROPIC_BASE_URL;
    } else {
      process.env.ANTHROPIC_BASE_URL = previousDirectBaseUrl;
    }

    if (previousDirectApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = previousDirectApiKey;
    }

    if (previousGeminiIntegrationBaseUrl === undefined) {
      delete process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
    } else {
      process.env.AI_INTEGRATIONS_GEMINI_BASE_URL = previousGeminiIntegrationBaseUrl;
    }

    if (previousGeminiIntegrationApiKey === undefined) {
      delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    } else {
      process.env.AI_INTEGRATIONS_GEMINI_API_KEY = previousGeminiIntegrationApiKey;
    }

    if (previousGeminiDirectBaseUrl === undefined) {
      delete process.env.GEMINI_BASE_URL;
    } else {
      process.env.GEMINI_BASE_URL = previousGeminiDirectBaseUrl;
    }

    if (previousGeminiDirectApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = previousGeminiDirectApiKey;
    }

    if (previousOpenRouterIntegrationBaseUrl === undefined) {
      delete process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL;
    } else {
      process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL = previousOpenRouterIntegrationBaseUrl;
    }

    if (previousOpenRouterIntegrationApiKey === undefined) {
      delete process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
    } else {
      process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY = previousOpenRouterIntegrationApiKey;
    }

    if (previousOpenRouterDirectBaseUrl === undefined) {
      delete process.env.OPENROUTER_BASE_URL;
    } else {
      process.env.OPENROUTER_BASE_URL = previousOpenRouterDirectBaseUrl;
    }

    if (previousOpenRouterDirectApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = previousOpenRouterDirectApiKey;
    }

    if (previousProxyKey === undefined) {
      delete process.env.PROXY_API_KEY;
    } else {
      process.env.PROXY_API_KEY = previousProxyKey;
    }
  }
});

test("proxy-info reports ready when direct Gemini secrets are provided", async () => {
  const previousBaseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  const previousApiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  const previousDirectBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const previousDirectApiKey = process.env.ANTHROPIC_API_KEY;
  const previousGeminiIntegrationBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const previousGeminiIntegrationApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const previousGeminiDirectBaseUrl = process.env.GEMINI_BASE_URL;
  const previousGeminiDirectApiKey = process.env.GEMINI_API_KEY;
  const previousOpenRouterIntegrationBaseUrl = process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL;
  const previousOpenRouterIntegrationApiKey = process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
  const previousOpenRouterDirectBaseUrl = process.env.OPENROUTER_BASE_URL;
  const previousOpenRouterDirectApiKey = process.env.OPENROUTER_API_KEY;
  const previousProxyKey = process.env.PROXY_API_KEY;
  const port = await getFreePort();

  delete process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  delete process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  process.env.GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
  process.env.GEMINI_API_KEY = "gemini-direct-test-key";
  delete process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL;
  delete process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_BASE_URL;
  delete process.env.OPENROUTER_API_KEY;
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
          gemini?: {
            configured?: boolean;
          };
          openrouter?: {
            configured?: boolean;
          };
        };
      };

      assert.equal(body.ready, true);
      assert.equal(body.integrations?.anthropic?.configured, false);
      assert.equal(body.integrations?.gemini?.configured, true);
      assert.equal(body.integrations?.openrouter?.configured, false);
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

    if (previousDirectBaseUrl === undefined) {
      delete process.env.ANTHROPIC_BASE_URL;
    } else {
      process.env.ANTHROPIC_BASE_URL = previousDirectBaseUrl;
    }

    if (previousDirectApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = previousDirectApiKey;
    }

    if (previousGeminiIntegrationBaseUrl === undefined) {
      delete process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
    } else {
      process.env.AI_INTEGRATIONS_GEMINI_BASE_URL = previousGeminiIntegrationBaseUrl;
    }

    if (previousGeminiIntegrationApiKey === undefined) {
      delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    } else {
      process.env.AI_INTEGRATIONS_GEMINI_API_KEY = previousGeminiIntegrationApiKey;
    }

    if (previousGeminiDirectBaseUrl === undefined) {
      delete process.env.GEMINI_BASE_URL;
    } else {
      process.env.GEMINI_BASE_URL = previousGeminiDirectBaseUrl;
    }

    if (previousGeminiDirectApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = previousGeminiDirectApiKey;
    }

    if (previousOpenRouterIntegrationBaseUrl === undefined) {
      delete process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL;
    } else {
      process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL = previousOpenRouterIntegrationBaseUrl;
    }

    if (previousOpenRouterIntegrationApiKey === undefined) {
      delete process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
    } else {
      process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY = previousOpenRouterIntegrationApiKey;
    }

    if (previousOpenRouterDirectBaseUrl === undefined) {
      delete process.env.OPENROUTER_BASE_URL;
    } else {
      process.env.OPENROUTER_BASE_URL = previousOpenRouterDirectBaseUrl;
    }

    if (previousOpenRouterDirectApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = previousOpenRouterDirectApiKey;
    }

    if (previousProxyKey === undefined) {
      delete process.env.PROXY_API_KEY;
    } else {
      process.env.PROXY_API_KEY = previousProxyKey;
    }
  }
});

test("proxy-info reports ready when direct OpenRouter secrets are provided", async () => {
  const previousBaseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  const previousApiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  const previousDirectBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const previousDirectApiKey = process.env.ANTHROPIC_API_KEY;
  const previousGeminiIntegrationBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const previousGeminiIntegrationApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const previousGeminiDirectBaseUrl = process.env.GEMINI_BASE_URL;
  const previousGeminiDirectApiKey = process.env.GEMINI_API_KEY;
  const previousOpenRouterIntegrationBaseUrl = process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL;
  const previousOpenRouterIntegrationApiKey = process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
  const previousOpenRouterDirectBaseUrl = process.env.OPENROUTER_BASE_URL;
  const previousOpenRouterDirectApiKey = process.env.OPENROUTER_API_KEY;
  const previousProxyKey = process.env.PROXY_API_KEY;
  const port = await getFreePort();

  delete process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  delete process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  delete process.env.GEMINI_BASE_URL;
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL;
  delete process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
  process.env.OPENROUTER_BASE_URL = "https://openrouter.byok.test/api/v1";
  process.env.OPENROUTER_API_KEY = "openrouter-direct-test-key";
  process.env.PROXY_API_KEY = "sk-proxy-test";

  try {
    const { default: app } = await import("../../artifacts/api-server/src/app.ts");
    const server = app.listen(port);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/proxy-info`);
      assert.equal(response.status, 200);

      const body = await response.json() as {
        ready?: boolean;
        providers?: string[];
        integrations?: {
          anthropic?: {
            configured?: boolean;
          };
          gemini?: {
            configured?: boolean;
          };
          openrouter?: {
            configured?: boolean;
          };
        };
      };

      assert.equal(body.ready, true);
      assert.ok(body.providers?.includes("openrouter"));
      assert.equal(body.integrations?.anthropic?.configured, false);
      assert.equal(body.integrations?.gemini?.configured, false);
      assert.equal(body.integrations?.openrouter?.configured, true);
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

    if (previousDirectBaseUrl === undefined) {
      delete process.env.ANTHROPIC_BASE_URL;
    } else {
      process.env.ANTHROPIC_BASE_URL = previousDirectBaseUrl;
    }

    if (previousDirectApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = previousDirectApiKey;
    }

    if (previousGeminiIntegrationBaseUrl === undefined) {
      delete process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
    } else {
      process.env.AI_INTEGRATIONS_GEMINI_BASE_URL = previousGeminiIntegrationBaseUrl;
    }

    if (previousGeminiIntegrationApiKey === undefined) {
      delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    } else {
      process.env.AI_INTEGRATIONS_GEMINI_API_KEY = previousGeminiIntegrationApiKey;
    }

    if (previousGeminiDirectBaseUrl === undefined) {
      delete process.env.GEMINI_BASE_URL;
    } else {
      process.env.GEMINI_BASE_URL = previousGeminiDirectBaseUrl;
    }

    if (previousGeminiDirectApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = previousGeminiDirectApiKey;
    }

    if (previousOpenRouterIntegrationBaseUrl === undefined) {
      delete process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL;
    } else {
      process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL = previousOpenRouterIntegrationBaseUrl;
    }

    if (previousOpenRouterIntegrationApiKey === undefined) {
      delete process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY;
    } else {
      process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY = previousOpenRouterIntegrationApiKey;
    }

    if (previousOpenRouterDirectBaseUrl === undefined) {
      delete process.env.OPENROUTER_BASE_URL;
    } else {
      process.env.OPENROUTER_BASE_URL = previousOpenRouterDirectBaseUrl;
    }

    if (previousOpenRouterDirectApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = previousOpenRouterDirectApiKey;
    }

    if (previousProxyKey === undefined) {
      delete process.env.PROXY_API_KEY;
    } else {
      process.env.PROXY_API_KEY = previousProxyKey;
    }
  }
});
