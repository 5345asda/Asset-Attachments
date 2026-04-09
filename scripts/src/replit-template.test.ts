import test from "node:test";
import assert from "node:assert/strict";

import {
  getApiOrigin,
  getHealthzUrl,
  getProxyInfoUrl,
  getOpenAIBaseUrl,
} from "../../artifacts/status-page/src/lib/runtime-config.ts";

test("getApiOrigin preserves the current origin port when no override is provided", () => {
  assert.equal(
    getApiOrigin({
      locationOrigin: "https://proxy.example:8443",
    }),
    "https://proxy.example:8443",
  );
});

test("getApiOrigin normalizes an explicit override", () => {
  assert.equal(
    getApiOrigin({
      locationOrigin: "https://status.example",
      overrideOrigin: "https://api.example.com/",
    }),
    "https://api.example.com",
  );
});

test("runtime config URLs are derived from the resolved API origin", () => {
  const expectedOrigin = "https://proxy.example:8443";

  assert.equal(
    getProxyInfoUrl({
      locationOrigin: expectedOrigin,
    }),
    `${expectedOrigin}/api/proxy-info`,
  );
  assert.equal(
    getHealthzUrl({
      locationOrigin: expectedOrigin,
    }),
    `${expectedOrigin}/api/healthz`,
  );
  assert.equal(
    getOpenAIBaseUrl({
      locationOrigin: expectedOrigin,
    }),
    `${expectedOrigin}/api/v1`,
  );
});
