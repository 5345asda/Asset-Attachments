import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("api app serves the SPA fallback route when STATIC_DIR is configured", async (t) => {
  const staticDir = await mkdtemp(path.join(tmpdir(), "asset-attachments-static-"));
  const indexHtml = "<!doctype html><html><body>ok</body></html>";

  await writeFile(path.join(staticDir, "index.html"), indexHtml, "utf8");

  const previousStaticDir = process.env.STATIC_DIR;
  const previousProxyKey = process.env.PROXY_API_KEY;

  process.env.STATIC_DIR = staticDir;
  process.env.PROXY_API_KEY = "sk-proxy-test";

  t.after(async () => {
    if (previousStaticDir === undefined) {
      delete process.env.STATIC_DIR;
    } else {
      process.env.STATIC_DIR = previousStaticDir;
    }

    if (previousProxyKey === undefined) {
      delete process.env.PROXY_API_KEY;
    } else {
      process.env.PROXY_API_KEY = previousProxyKey;
    }

    await rm(staticDir, { recursive: true, force: true });
  });

  const { default: app } = await import("../../artifacts/api-server/src/app.ts");
  const server = app.listen(0);

  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Expected an ephemeral TCP port for the test server.");
  }

  const response = await fetch(`http://127.0.0.1:${address.port}/anything`);

  assert.equal(response.status, 200);
  assert.equal(await response.text(), indexHtml);
});
