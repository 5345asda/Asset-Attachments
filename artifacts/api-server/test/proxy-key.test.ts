import test from "node:test";
import assert from "node:assert/strict";

import { getProxyApiKeyConfig } from "../src/lib/proxy-key.ts";
import { withEnv } from "./helpers.ts";

test("getProxyApiKeyConfig disables proxy auth when PROXY_API_KEY is missing", async () => {
  await withEnv({
    PROXY_API_KEY: undefined,
  }, async () => {
    assert.deepEqual(getProxyApiKeyConfig(), {
      configured: false,
      value: "",
      source: "none",
    });
  });
});

test("getProxyApiKeyConfig reads PROXY_API_KEY from env only", async () => {
  await withEnv({
    PROXY_API_KEY: "  sk-proxy-from-env  ",
  }, async () => {
    assert.deepEqual(getProxyApiKeyConfig(), {
      configured: true,
      value: "sk-proxy-from-env",
      source: "env",
    });
  });
});
