import assert from "node:assert/strict";
import test from "node:test";

import {
  AXONHUB_ORIGIN,
  AXONHUB_DEFAULT_TEST_MODEL,
  AXONHUB_SUPPORTED_MODELS,
  buildAxonHubChannelInput,
  normalizeAxonHubToken,
  syncAxonHubChannel,
} from "../../artifacts/api-server/src/lib/axonhub.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

type FetchInput = Parameters<typeof fetch>[0];

test("normalizeAxonHubToken accepts bare tokens and preserves Bearer tokens", () => {
  assert.equal(normalizeAxonHubToken("plain-token"), "Bearer plain-token");
  assert.equal(normalizeAxonHubToken("Bearer already-prefixed"), "Bearer already-prefixed");
});

test("buildAxonHubChannelInput uses the fixed anthropic channel format", () => {
  const input = buildAxonHubChannelInput({
    projectOrigin: "https://proxy.example:8443/",
    proxyKey: "sk-proxy-test",
  });

  assert.deepEqual(input, {
    type: "anthropic",
    name: "proxy",
    baseURL: "https://proxy.example:8443/api/anthropic",
    status: "enabled",
    credentials: {
      apiKey: "sk-proxy-test",
    },
    supportedModels: AXONHUB_SUPPORTED_MODELS,
    defaultTestModel: AXONHUB_DEFAULT_TEST_MODEL,
    manualModels: AXONHUB_SUPPORTED_MODELS,
    autoSyncSupportedModels: false,
    autoSyncModelPattern: "",
    tags: [],
    remark: "Managed by Asset-Attachments",
  });
});

test("syncAxonHubChannel creates a new channel when the current base URL is missing", async () => {
  const calls: Array<{ input: FetchInput; init?: RequestInit }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    calls.push({ input, init });

    const body = JSON.parse(String(init?.body ?? "{}")) as {
      query?: string;
      variables?: {
        input?: unknown;
      };
    };

    if (body.query?.includes("query SyncAxonHubChannelLookup")) {
      return jsonResponse({
        data: {
          queryChannels: {
            edges: [],
          },
        },
      });
    }

    if (body.query?.includes("mutation CreateChannel")) {
      return jsonResponse({
        data: {
          createChannel: {
            id: "gid://axonhub/Channel/99",
            name: "proxy",
            baseURL: "https://proxy.example/api/anthropic",
            status: "enabled",
          },
        },
      });
    }

    throw new Error(`Unexpected GraphQL document: ${body.query}`);
  };

  const result = await syncAxonHubChannel({
    projectOrigin: "https://proxy.example",
    proxyKey: "sk-proxy-test",
    adminToken: "plain-token",
    fetchImpl: fetchMock,
  });

  assert.equal(result.mode, "created");
  assert.equal(result.channel.id, "gid://axonhub/Channel/99");
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.input, `${AXONHUB_ORIGIN}/admin/graphql`);
  assert.equal(calls[1]?.input, `${AXONHUB_ORIGIN}/admin/graphql`);
  assert.equal(
    (calls[0]?.init?.headers as Record<string, string>)?.Authorization,
    "Bearer plain-token",
  );

  const createBody = JSON.parse(String(calls[1]?.init?.body ?? "{}")) as {
    variables?: {
      input?: unknown;
    };
  };

  assert.deepEqual(createBody.variables?.input, {
    type: "anthropic",
    name: "proxy",
    baseURL: "https://proxy.example/api/anthropic",
    status: "enabled",
    credentials: {
      apiKey: "sk-proxy-test",
    },
    supportedModels: AXONHUB_SUPPORTED_MODELS,
    defaultTestModel: AXONHUB_DEFAULT_TEST_MODEL,
    manualModels: AXONHUB_SUPPORTED_MODELS,
    autoSyncSupportedModels: false,
    autoSyncModelPattern: "",
    tags: [],
    remark: "Managed by Asset-Attachments",
  });
});

test("syncAxonHubChannel updates an existing channel with the same base URL", async () => {
  const calls: Array<{ input: FetchInput; init?: RequestInit }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    calls.push({ input, init });

    const body = JSON.parse(String(init?.body ?? "{}")) as {
      query?: string;
      variables?: {
        id?: string;
      };
    };

    if (body.query?.includes("query SyncAxonHubChannelLookup")) {
      return jsonResponse({
        data: {
          queryChannels: {
            edges: [
              {
                node: {
                  id: "gid://axonhub/Channel/7",
                  name: "old-name",
                  baseURL: "https://proxy.example/api/anthropic",
                },
              },
            ],
          },
        },
      });
    }

    if (body.query?.includes("mutation UpdateChannel")) {
      return jsonResponse({
        data: {
          updateChannel: {
            id: body.variables?.id,
            name: "proxy",
            baseURL: "https://proxy.example/api/anthropic",
            status: "enabled",
          },
        },
      });
    }

    throw new Error(`Unexpected GraphQL document: ${body.query}`);
  };

  const result = await syncAxonHubChannel({
    projectOrigin: "https://proxy.example",
    proxyKey: "sk-proxy-test",
    adminToken: "Bearer prefilled-token",
    fetchImpl: fetchMock,
  });

  assert.equal(result.mode, "updated");
  assert.equal(result.channel.id, "gid://axonhub/Channel/7");
  assert.equal(calls.length, 2);

  const updateBody = JSON.parse(String(calls[1]?.init?.body ?? "{}")) as {
    variables?: {
      id?: string;
      input?: unknown;
    };
  };

  assert.equal(updateBody.variables?.id, "gid://axonhub/Channel/7");
  assert.deepEqual(updateBody.variables?.input, {
    type: "anthropic",
    name: "proxy",
    baseURL: "https://proxy.example/api/anthropic",
    status: "enabled",
    credentials: {
      apiKey: "sk-proxy-test",
    },
    supportedModels: AXONHUB_SUPPORTED_MODELS,
    defaultTestModel: AXONHUB_DEFAULT_TEST_MODEL,
    manualModels: AXONHUB_SUPPORTED_MODELS,
    autoSyncSupportedModels: false,
    autoSyncModelPattern: "",
    tags: [],
    remark: "Managed by Asset-Attachments",
  });
});
