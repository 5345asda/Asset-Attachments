import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const proxyKeyModuleUrl = pathToFileURL(
  path.join(repoRoot, "artifacts", "api-server", "src", "lib", "proxy-key.ts"),
).href;
const fixedProxyKey = "sk-proxy-6f2d0c9a47b13e8d5f71a2c46be93d07f8c1a54e692db3fc";

type ProxyKeyModule = {
  DEFAULT_PROXY_API_KEY: string;
  PROXY_API_KEY: string;
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

test("proxy key defaults to the fixed repo key across fresh imports", async (t) => {
  const envSnapshot = captureEnv();

  t.after(() => {
    restoreEnv(envSnapshot);
  });

  delete process.env.PROXY_API_KEY;

  const firstBoot = await importFreshProxyKeyModule(`first-${Date.now()}`);
  const secondBoot = await importFreshProxyKeyModule(`second-${Date.now()}`);

  assert.equal(firstBoot.DEFAULT_PROXY_API_KEY, fixedProxyKey);
  assert.equal(firstBoot.PROXY_API_KEY, fixedProxyKey);
  assert.equal(secondBoot.PROXY_API_KEY, firstBoot.PROXY_API_KEY);
});
