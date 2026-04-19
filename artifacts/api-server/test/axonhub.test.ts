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

test("syncAxonHubChannel paginates past the first 100 channels before choosing provider", async () => {
  const lookupPageOne = Array.from({ length: 100 }, (_, index) => ({
    node: makeChannel(index + 1),
  }));

  const projectOrigin = "https://asset-attachments--nicole19720518.replit.app";
  const geminiBaseUrl = `${projectOrigin}/api/gemini`;
  const lookupPageTwo = [
    ...Array.from({ length: 16 }, (_, index) => ({
      node: makeChannel(200 + index, {
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
      const after = ((payload.variables.input as Record<string, unknown> | undefined)?.after as string | undefined) ?? null;

      const data = after
        ? {
            queryChannels: {
              edges: lookupPageTwo,
              pageInfo: {
                hasNextPage: false,
                endCursor: null,
              },
            },
          }
        : {
            queryChannels: {
              edges: lookupPageOne,
              pageInfo: {
                hasNextPage: true,
                endCursor: "cursor-1",
              },
            },
          };

      return new Response(JSON.stringify({ data }), {
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

  assert.equal(lookupRequests.length, 2);
  assert.equal(lookupRequests.every((request) => request.query.includes("pageInfo")), true);
  assert.deepEqual(lookupRequests.map((request) => request.variables.input), [
    { first: 100 },
    { first: 100, after: "cursor-1" },
  ]);
  assert.equal(result.provider, "gemini");
  assert.equal(result.mode, "updated");
  assert.equal(result.channel.baseURL, geminiBaseUrl);
});
