import test from "node:test";
import assert from "node:assert/strict";

import { syncAxonHubChannel } from "../src/lib/axonhub.ts";

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
  const geminiBaseUrl = `${projectOrigin}/api/gemini`;
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

  const requests: Array<{
    query: string;
    variables: Record<string, unknown>;
  }> = [];

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

  assert.equal(lookupRequests.length, 1);
  assert.deepEqual(lookupRequests[0]?.variables.input, {});
  assert.equal(result.provider, "gemini");
  assert.equal(result.mode, "updated");
  assert.equal(result.channel.baseURL, geminiBaseUrl);
});
