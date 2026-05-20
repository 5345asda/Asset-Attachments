import test from "node:test";
import assert from "node:assert/strict";

import { syncAxonHubChannel } from "../src/lib/axonhub.ts";

function expectedAxonHubBaseUrl(
  projectOrigin: string,
  provider: "anthropic" | "gemini" | "openai" | "openrouter" | "codex",
): string {
  const basePathProvider = provider === "codex" ? "openai" : provider;
  return `${projectOrigin}/api/${basePathProvider}`;
}

function makeChannel(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `gid://axonhub/Channel/${id}`,
    name: `channel-${id}`,
    type: "anthropic",
    baseURL: `https://example-${id}.replit.app/api/anthropic`,
    remark: "",
    status: "archived",
    ...overrides,
  };
}

test("syncAxonHubChannel fetches the full channel list without pagination before choosing provider", async () => {
  const projectOrigin = "https://asset-attachments--nicole19720518.replit.app";
  const geminiBaseUrl = expectedAxonHubBaseUrl(projectOrigin, "gemini");
  const requests: Array<{
    query: string;
    variables: Record<string, unknown>;
  }> = [];
  const lookupEdges = [
    ...Array.from({ length: 10 }, (_, index) => ({
      node: makeChannel(200 + index, {
        type: "anthropic",
        remark: "Managed by Asset-Attachments",
        status: "enabled",
      }),
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      node: makeChannel(300 + index, {
        type: "openrouter",
        baseURL: `https://openrouter-${300 + index}.replit.app/api/openrouter`,
        remark: "Managed by Asset-Attachments",
        status: "enabled",
      }),
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
      node: makeChannel(400 + index, {
        type: "gemini",
        baseURL: `https://gemini-${400 + index}.replit.app/api/gemini`,
        remark: "Managed by Asset-Attachments",
        status: "enabled",
      }),
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      node: makeChannel(500 + index, {
        type: "openai",
        baseURL: `https://openai-${500 + index}.replit.app/api/openai`,
        remark: "Managed by Asset-Attachments",
        status: "enabled",
      }),
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      node: makeChannel(600 + index, {
        type: "codex",
        baseURL: `https://codex-${600 + index}.replit.app/api/openai`,
        remark: "Managed by Asset-Attachments",
        status: "enabled",
      }),
    })),
    {
      node: makeChannel(500, {
        name: "asset-attachments--nicole19720518",
        type: "gemini",
        baseURL: geminiBaseUrl,
        remark: "Managed by Asset-Attachments",
        status: "enabled",
      }),
    },
  ];

  const fetchImpl: typeof fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as {
      query: string;
      variables: Record<string, unknown>;
    };
    requests.push(payload);

    if (payload.query.includes("query SyncAxonHubChannelLookup")) {
      return new Response(JSON.stringify({
        data: {
          queryChannels: {
            edges: lookupEdges,
          },
        },
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    if (payload.query.includes("mutation UpdateChannel")) {
      return new Response(JSON.stringify({
        data: {
          updateChannel: {
            id: "gid://axonhub/Channel/500",
            name: "asset-attachments--nicole19720518",
            baseURL: geminiBaseUrl,
            status: "enabled",
          },
        },
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    if (payload.query.includes("mutation CreateChannel")) {
      return new Response(JSON.stringify({
        data: {
          createChannel: {
            id: "gid://axonhub/Channel/999",
            name: "asset-attachments--nicole19720518",
            baseURL: `${projectOrigin}/api/anthropic`,
            status: "enabled",
          },
        },
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    throw new Error(`Unexpected GraphQL operation: ${payload.query}`);
  };

  const result = await syncAxonHubChannel({
    projectOrigin,
    proxyKey: "sk-proxy-test",
    adminToken: "test-token",
    fetchImpl,
  });

  const lookupRequests = requests.filter((request) => request.query.includes("query SyncAxonHubChannelLookup"));
  const updateRequests = requests.filter((request) => request.query.includes("mutation UpdateChannel"));

  assert.equal(lookupRequests.length, 1);
  assert.equal(updateRequests.length, 1);
  assert.deepEqual(lookupRequests[0]?.variables.input, {});
  assert.deepEqual(updateRequests[0]?.variables, {
    id: "gid://axonhub/Channel/500",
    input: {
      type: "gemini",
      name: "asset-attachments--nicole19720518",
      baseURL: geminiBaseUrl,
      status: "enabled",
      credentials: {
        apiKey: "sk-proxy-test",
      },
      supportedModels: [
        "gemini-3.1-pro-preview",
        "gemini-3-flash-preview",
        "gemini-3-pro-image-preview",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "gemini-2.5-flash-image",
      ],
      defaultTestModel: "gemini-2.5-flash",
      manualModels: [
        "gemini-3.1-pro-preview",
        "gemini-3-flash-preview",
        "gemini-3-pro-image-preview",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
        "gemini-2.5-flash-image",
      ],
      autoSyncSupportedModels: false,
      autoSyncModelPattern: "",
      settings: {
        passThroughBody: false,
      },
      tags: [],
      remark: "Managed by Asset-Attachments",
    },
  });
  assert.equal(result.provider, "gemini");
  assert.equal(result.mode, "updated");
  assert.equal(result.channel.baseURL, geminiBaseUrl);
});
