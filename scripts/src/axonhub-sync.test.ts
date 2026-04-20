import assert from "node:assert/strict";
import test from "node:test";

import {
  AXONHUB_ORIGIN,
  AXONHUB_DEFAULT_TEST_MODEL,
  AXONHUB_SUPPORTED_MODELS,
  AXONHUB_GEMINI_DEFAULT_TEST_MODEL,
  AXONHUB_GEMINI_SUPPORTED_MODELS,
  AXONHUB_OPENROUTER_DEFAULT_TEST_MODEL,
  AXONHUB_OPENROUTER_SUPPORTED_MODELS,
  buildAxonHubChannelInput,
  normalizeAxonHubToken,
  pickAxonHubChannelProvider,
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
const EXPECTED_AXONHUB_GEMINI_MODELS = [
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3-pro-image-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-image",
] as const;
const EXPECTED_AXONHUB_OPENROUTER_MODELS = [
  "moonshotai/kimi-k2.6",
  "moonshotai/kimi-k2.5",
  "z-ai/glm-5.1",
  "z-ai/glm-5v-turbo",
  "z-ai/glm-5-turbo",
  "z-ai/glm-5",
  "z-ai/glm-4.7-flash",
  "z-ai/glm-4.7",
  "openai/gpt-5.4-nano",
  "openai/gpt-5.4-pro",
  "openai/gpt-4o",
  "x-ai/grok-4.20-multi-agent",
  "x-ai/grok-4.20",
  "deepseek/deepseek-v3.2",
  "deepseek/deepseek-v3.2-exp",
  "deepseek/deepseek-r1",
  "deepseek/deepseek-r1-0528",
  "minimax/minimax-m2.7",
  "minimax/minimax-m2.5",
] as const;

function managedChannel({
  id,
  type,
  baseURL,
  status = "enabled",
}: {
  id: string;
  type: string;
  baseURL: string;
  status?: string;
}) {
  return {
    id,
    name: "proxy",
    type,
    baseURL,
    status,
    remark: "Managed by Asset-Attachments",
  };
}

function managedAnthropicChannels(count: number) {
  return Array.from({ length: count }, (_, index) => managedChannel({
    id: `gid://axonhub/Channel/${index + 1}`,
    type: "anthropic",
    baseURL: `https://anthropic-${index + 1}.example/api/anthropic`,
  }));
}

test("normalizeAxonHubToken accepts bare tokens and preserves Bearer tokens", () => {
  assert.equal(normalizeAxonHubToken("plain-token"), "Bearer plain-token");
  assert.equal(normalizeAxonHubToken("Bearer already-prefixed"), "Bearer already-prefixed");
});

test("buildAxonHubChannelInput uses the fixed anthropic channel format", () => {
  const input = buildAxonHubChannelInput({
    provider: "anthropic",
    projectOrigin: "https://proxy.example:8443/",
    proxyKey: "sk-proxy-test",
  });

  assert.deepEqual(input, {
    type: "anthropic",
    name: "proxy",
    baseURL: "https://proxy.example:8443/api/anthropic",
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

test("buildAxonHubChannelInput uses the fixed gemini channel format", () => {
  const input = buildAxonHubChannelInput({
    provider: "gemini",
    projectOrigin: "https://proxy.example:8443/",
    proxyKey: "sk-proxy-test",
  });

  assert.deepEqual(input, {
    type: "gemini",
    name: "proxy",
    baseURL: "https://proxy.example:8443/api/gemini",
    credentials: {
      apiKey: "sk-proxy-test",
    },
    supportedModels: EXPECTED_AXONHUB_GEMINI_MODELS,
    defaultTestModel: AXONHUB_GEMINI_DEFAULT_TEST_MODEL,
    manualModels: EXPECTED_AXONHUB_GEMINI_MODELS,
    autoSyncSupportedModels: false,
    autoSyncModelPattern: "",
    tags: [],
    remark: "Managed by Asset-Attachments",
  });
});

test("buildAxonHubChannelInput uses the fixed openrouter channel format", () => {
  const input = buildAxonHubChannelInput({
    provider: "openrouter",
    projectOrigin: "https://proxy.example:8443/",
    proxyKey: "sk-proxy-test",
  });

  assert.deepEqual(input, {
    type: "openrouter",
    name: "proxy",
    baseURL: "https://proxy.example:8443/api/openrouter",
    credentials: {
      apiKey: "sk-proxy-test",
    },
    supportedModels: EXPECTED_AXONHUB_OPENROUTER_MODELS,
    defaultTestModel: AXONHUB_OPENROUTER_DEFAULT_TEST_MODEL,
    manualModels: EXPECTED_AXONHUB_OPENROUTER_MODELS,
    autoSyncSupportedModels: false,
    autoSyncModelPattern: "",
    tags: [],
    remark: "Managed by Asset-Attachments",
  });
});

test("pickAxonHubChannelProvider only counts managed non-archived channels toward the 8:1:1 ratio", () => {
  const provider = pickAxonHubChannelProvider([
    managedChannel({
      id: "gid://axonhub/Channel/1",
      type: "anthropic",
      baseURL: "https://one.example/api/anthropic",
    }),
    managedChannel({
      id: "gid://axonhub/Channel/2",
      type: "anthropic",
      baseURL: "https://two.example/api/anthropic",
    }),
    managedChannel({
      id: "gid://axonhub/Channel/3",
      type: "anthropic",
      baseURL: "https://three.example/api/anthropic",
    }),
    managedChannel({
      id: "gid://axonhub/Channel/4",
      type: "anthropic",
      baseURL: "https://four.example/api/anthropic",
    }),
    managedChannel({
      id: "gid://axonhub/Channel/5",
      type: "anthropic",
      baseURL: "https://five.example/api/anthropic",
    }),
    managedChannel({
      id: "gid://axonhub/Channel/6",
      type: "anthropic",
      baseURL: "https://six.example/api/anthropic",
    }),
    managedChannel({
      id: "gid://axonhub/Channel/7",
      type: "anthropic",
      baseURL: "https://seven.example/api/anthropic",
    }),
    managedChannel({
      id: "gid://axonhub/Channel/8",
      type: "anthropic",
      baseURL: "https://archived.example/api/anthropic",
      status: "archived",
    }),
    {
      id: "gid://axonhub/Channel/9",
      name: "proxy",
      type: "anthropic",
      baseURL: "https://external.example/api/anthropic",
      status: "enabled",
      remark: "External channel",
    },
  ]);

  assert.equal(provider, "gemini");
});

test("pickAxonHubChannelProvider switches to gemini after four managed anthropic channels fill the first 8:1:1 block", () => {
  const provider = pickAxonHubChannelProvider(managedAnthropicChannels(4));

  assert.equal(provider, "gemini");
});

test("pickAxonHubChannelProvider switches to gemini after eight managed anthropic channels fill the next slot", () => {
  const provider = pickAxonHubChannelProvider(managedAnthropicChannels(8));

  assert.equal(provider, "gemini");
});

test("pickAxonHubChannelProvider switches to openrouter after gemini fills the first secondary slot", () => {
  const provider = pickAxonHubChannelProvider([
    ...managedAnthropicChannels(16),
    managedChannel({
      id: "gid://axonhub/Channel/17",
      type: "gemini",
      baseURL: "https://gemini.example/api/gemini",
    }),
  ]);

  assert.equal(provider, "openrouter");
});

test("pickAxonHubChannelProvider normalizes title-cased provider names from AxonHub before counting", () => {
  const provider = pickAxonHubChannelProvider([
    managedChannel({
      id: "gid://axonhub/Channel/1",
      type: "Anthropic",
      baseURL: "https://one.example/api/anthropic",
    }),
    managedChannel({
      id: "gid://axonhub/Channel/2",
      type: "Anthropic",
      baseURL: "https://two.example/api/anthropic",
    }),
    managedChannel({
      id: "gid://axonhub/Channel/3",
      type: "Anthropic",
      baseURL: "https://three.example/api/anthropic",
    }),
    managedChannel({
      id: "gid://axonhub/Channel/4",
      type: "Anthropic",
      baseURL: "https://four.example/api/anthropic",
    }),
    managedChannel({
      id: "gid://axonhub/Channel/5",
      type: "Anthropic",
      baseURL: "https://five.example/api/anthropic",
    }),
    managedChannel({
      id: "gid://axonhub/Channel/6",
      type: "Anthropic",
      baseURL: "https://six.example/api/anthropic",
    }),
    managedChannel({
      id: "gid://axonhub/Channel/7",
      type: "Anthropic",
      baseURL: "https://seven.example/api/anthropic",
    }),
    managedChannel({
      id: "gid://axonhub/Channel/8",
      type: "Anthropic",
      baseURL: "https://eight.example/api/anthropic",
    }),
  ]);

  assert.equal(provider, "gemini");
});

test("syncAxonHubChannel creates a new anthropic channel when anthropic is under target", async () => {
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
            edges: [
              {
                node: managedChannel({
                  id: "gid://axonhub/Channel/1",
                  type: "anthropic",
                  baseURL: "https://other.example/api/anthropic",
                }),
              },
            ],
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
            type: "anthropic",
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
  assert.equal(result.provider, "anthropic");
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

test("syncAxonHubChannel updates the existing anthropic channel for the current project", async () => {
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
                node: managedChannel({
                  id: "gid://axonhub/Channel/1",
                  type: "anthropic",
                  baseURL: "https://other.example/api/anthropic",
                }),
              },
              {
                node: managedChannel({
                  id: "gid://axonhub/Channel/7",
                  type: "anthropic",
                  baseURL: "https://proxy.example/api/anthropic",
                }),
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
            type: "anthropic",
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
  assert.equal(result.provider, "anthropic");
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

test("syncAxonHubChannel updates the existing anthropic channel when AxonHub returns title-cased provider names", async () => {
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
                node: managedChannel({
                  id: "gid://axonhub/Channel/1",
                  type: "Anthropic",
                  baseURL: "https://other.example/api/anthropic",
                }),
              },
              {
                node: managedChannel({
                  id: "gid://axonhub/Channel/7",
                  type: "Anthropic",
                  baseURL: "https://proxy.example/api/anthropic",
                }),
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
            type: "Anthropic",
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
  assert.equal(result.provider, "anthropic");
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

test("syncAxonHubChannel creates a new gemini channel when the next slot belongs to gemini", async () => {
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
            edges: [
              { node: managedChannel({ id: "gid://axonhub/Channel/1", type: "anthropic", baseURL: "https://one.example/api/anthropic" }) },
              { node: managedChannel({ id: "gid://axonhub/Channel/2", type: "anthropic", baseURL: "https://two.example/api/anthropic" }) },
              { node: managedChannel({ id: "gid://axonhub/Channel/3", type: "anthropic", baseURL: "https://three.example/api/anthropic" }) },
              { node: managedChannel({ id: "gid://axonhub/Channel/4", type: "anthropic", baseURL: "https://four.example/api/anthropic" }) },
              { node: managedChannel({ id: "gid://axonhub/Channel/5", type: "anthropic", baseURL: "https://five.example/api/anthropic" }) },
              { node: managedChannel({ id: "gid://axonhub/Channel/6", type: "anthropic", baseURL: "https://six.example/api/anthropic" }) },
              { node: managedChannel({ id: "gid://axonhub/Channel/7", type: "anthropic", baseURL: "https://seven.example/api/anthropic" }) },
              { node: managedChannel({ id: "gid://axonhub/Channel/8", type: "anthropic", baseURL: "https://eight.example/api/anthropic" }) },
            ],
          },
        },
      });
    }

    if (body.query?.includes("mutation CreateChannel")) {
      return jsonResponse({
        data: {
          createChannel: {
            id: "gid://axonhub/Channel/109",
            name: "proxy",
            type: "gemini",
            baseURL: "https://proxy.example/api/gemini",
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
  assert.equal(result.provider, "gemini");

  const createBody = JSON.parse(String(calls[1]?.init?.body ?? "{}")) as {
    variables?: {
      input?: unknown;
    };
  };

  assert.deepEqual(createBody.variables?.input, {
    type: "gemini",
    name: "proxy",
    baseURL: "https://proxy.example/api/gemini",
    credentials: {
      apiKey: "sk-proxy-test",
    },
    supportedModels: EXPECTED_AXONHUB_GEMINI_MODELS,
    defaultTestModel: AXONHUB_GEMINI_DEFAULT_TEST_MODEL,
    manualModels: EXPECTED_AXONHUB_GEMINI_MODELS,
    autoSyncSupportedModels: false,
    autoSyncModelPattern: "",
    tags: [],
    remark: "Managed by Asset-Attachments",
  });
});

test("syncAxonHubChannel creates a new openrouter channel when the next secondary slot belongs to openrouter", async () => {
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
            edges: [
              ...managedAnthropicChannels(16).map((node) => ({ node })),
              {
                node: managedChannel({
                  id: "gid://axonhub/Channel/17",
                  type: "gemini",
                  baseURL: "https://gemini.example/api/gemini",
                }),
              },
            ],
          },
        },
      });
    }

    if (body.query?.includes("mutation CreateChannel")) {
      return jsonResponse({
        data: {
          createChannel: {
            id: "gid://axonhub/Channel/209",
            name: "proxy",
            type: "openrouter",
            baseURL: "https://proxy.example/api/openrouter",
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
  assert.equal(result.provider, "openrouter");

  const createBody = JSON.parse(String(calls[1]?.init?.body ?? "{}")) as {
    variables?: {
      input?: unknown;
    };
  };

  assert.deepEqual(createBody.variables?.input, {
    type: "openrouter",
    name: "proxy",
    baseURL: "https://proxy.example/api/openrouter",
    credentials: {
      apiKey: "sk-proxy-test",
    },
    supportedModels: EXPECTED_AXONHUB_OPENROUTER_MODELS,
    defaultTestModel: AXONHUB_OPENROUTER_DEFAULT_TEST_MODEL,
    manualModels: EXPECTED_AXONHUB_OPENROUTER_MODELS,
    autoSyncSupportedModels: false,
    autoSyncModelPattern: "",
    tags: [],
    remark: "Managed by Asset-Attachments",
  });
});
