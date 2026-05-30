import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const proxyKeyModuleUrl = pathToFileURL(
  path.join(repoRoot, "artifacts", "api-server", "src", "lib", "proxy-key.ts"),
).href;

type ProxyKeyModule = {
  getProxyApiKey: () => string;
  getProxyApiKeyConfig: () => {
    configured: boolean;
    value: string;
    source: "env" | "none";
  };
};

type EnvSnapshot = {
  PROXY_API_KEY: string | undefined;
};

async function importFreshProxyKeyModule(cacheBuster: string): Promise<ProxyKeyModule> {
  return await import(`${proxyKeyModuleUrl}?proxy-key-test=${cacheBuster}`) as ProxyKeyModule;
}

function captureEnv(): EnvSnapshot {
  return {
    PROXY_API_KEY: process.env.PROXY_API_KEY,
  };
}

function restoreEnv(snapshot: EnvSnapshot): void {
  if (snapshot.PROXY_API_KEY === undefined) {
    delete process.env.PROXY_API_KEY;
    return;
  }

  process.env.PROXY_API_KEY = snapshot.PROXY_API_KEY;
}

test("proxy key disables proxy auth across fresh imports when env is missing", async (t) => {
  const envSnapshot = captureEnv();

  t.after(() => {
    restoreEnv(envSnapshot);
  });

  delete process.env.PROXY_API_KEY;

  const firstBoot = await importFreshProxyKeyModule(`first-${Date.now()}`);
  const secondBoot = await importFreshProxyKeyModule(`second-${Date.now()}`);

  assert.deepEqual(firstBoot.getProxyApiKeyConfig(), {
    configured: false,
    value: "",
    source: "none",
  });
  assert.equal(firstBoot.getProxyApiKey(), "");
  assert.deepEqual(secondBoot.getProxyApiKeyConfig(), firstBoot.getProxyApiKeyConfig());
});
