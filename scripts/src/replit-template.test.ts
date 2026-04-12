import test from "node:test";
import assert from "node:assert/strict";

import {
  getApiOrigin,
  getAxonHubOrigin,
  getAxonHubSyncUrl,
  getDefaultAxonHubAdminToken,
  getHealthzUrl,
  getProxyInfoUrl,
  getAnthropicBaseUrl,
  getGatewayStatus,
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
    getAnthropicBaseUrl({
      locationOrigin: expectedOrigin,
    }),
    `${expectedOrigin}/api/anthropic`,
  );
  assert.equal(
    getAxonHubSyncUrl({
      locationOrigin: expectedOrigin,
    }),
    `${expectedOrigin}/api/axonhub/channel-sync`,
  );
});

test("AxonHub origin is fixed to the shared deployment", () => {
  assert.equal(getAxonHubOrigin(), "https://axonhub.qwqtao.com");
});

test("AxonHub admin token default is prefilled for release bundles", () => {
  assert.equal(
    getDefaultAxonHubAdminToken(),
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3NzY1MTcyODIsInVzZXJfaWQiOjF9.XYwKgpR1Zwgekt8hA7q8B0RJBg86Z4Otdw7XSa3S0Zw",
  );
});

test("gateway status reports setup_required when provider integration is missing", () => {
  assert.equal(
    getGatewayStatus({
      healthOk: true,
      anthropicConfigured: false,
    }),
    "setup_required",
  );
});
