import assert from "node:assert/strict";
import test from "node:test";

import {
  AXONHUB_ORIGIN,
  AXONHUB_CODEX_DEFAULT_TEST_MODEL,
  AXONHUB_CODEX_SUPPORTED_MODELS,
  AXONHUB_DEFAULT_TEST_MODEL,
  AXONHUB_SUPPORTED_MODELS,
  AXONHUB_GEMINI_DEFAULT_TEST_MODEL,
  AXONHUB_GEMINI_SUPPORTED_MODELS,
  AXONHUB_OPENAI_DEFAULT_TEST_MODEL,
  AXONHUB_OPENAI_SUPPORTED_MODELS,
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
type ManagedChannelStatus = "enabled" | "archived" | "disabled";

const EXPECTED_AXONHUB_GEMINI_MODELS = [
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3-pro-image-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-image",
] as const;

const EXPECTED_AXONHUB_OPENAI_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.2",
  "gpt-5.1",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o",
  "gpt-4o-mini",
  "o3",
  "o4-mini",
  "o3-mini",
] as const;

const EXPECTED_AXONHUB_CODEX_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.3-codex",
  "gpt-5.2",
  "gpt-5.1",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "o3",
  "o4-mini",
  "o3-mini",
] as const;

const EXPECTED_AXONHUB_OPENROUTER_MODELS = [
  "moonshotai/kimi-k2.6",
  "moonshotai/kimi-k2.5",
  "qwen/qwen3.6-flash",
  "qwen/qwen3.6-35b-a3b",
  "qwen/qwen3.6-max-preview",
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
  "deepseek/deepseek-v4-pro",
  "deepseek/deepseek-v4-flash",
  "deepseek/deepseek-v3.2",
  "deepseek/deepseek-v3.2-exp",
  "deepseek/deepseek-r1",
  "deepseek/deepseek-r1-0528",
  "minimax/minimax-m2.7",
  "minimax/minimax-m2.5",
  "xiaomi/mimo-v2.5",
  "xiaomi/mimo-v2.5-pro",
] as const;

const EXPECTED_AXONHUB_CHANNEL_SETTINGS = {
  passThroughBody: false,
} as const;

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function managedChannel({
  id,
  type,
  baseURL,
  status = "enabled",
  remark = "Managed by Asset-Attachments",
}: {
  id: string;
  type: string;
  baseURL: string;
  status?: string;
  remark?: string;
}) {
  return {
    id,
    name: "proxy",
    type,
    baseURL,
    status,
    remark,
  };
}

function managedProviderChannels(
  provider: "anthropic" | "gemini" | "openai" | "openrouter" | "codex",
  count: number,
  {
    status = "enabled",
    startIndex = 1,
    titleCaseType = false,
    titleCaseStatus = false,
  }: {
    status?: ManagedChannelStatus;
    startIndex?: number;
    titleCaseType?: boolean;
    titleCaseStatus?: boolean;
  } = {},
) {
  const type = titleCaseType ? toTitleCase(provider) : provider;
  const normalizedStatus = titleCaseStatus ? toTitleCase(status) : status;
  const basePathProvider = provider === "codex" ? "openai" : provider;

  return Array.from({ length: count }, (_, index) => managedChannel({
    id: `gid://axonhub/Channel/${startIndex + index}`,
    type,
    baseURL: `https://${provider}-${startIndex + index}.example/api/${basePathProvider}`,
    status: normalizedStatus,
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
    settings: EXPECTED_AXONHUB_CHANNEL_SETTINGS,
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
    settings: EXPECTED_AXONHUB_CHANNEL_SETTINGS,
    tags: [],
    remark: "Managed by Asset-Attachments",
  });
});

test("buildAxonHubChannelInput uses the fixed openai channel format", () => {
  const input = buildAxonHubChannelInput({
    provider: "openai",
    projectOrigin: "https://proxy.example:8443/",
    proxyKey: "sk-proxy-test",
  });

  assert.deepEqual(input, {
    type: "openai",
    name: "proxy",
    baseURL: "https://proxy.example:8443/api/openai",
    credentials: {
      apiKey: "sk-proxy-test",
    },
    supportedModels: EXPECTED_AXONHUB_OPENAI_MODELS,
    defaultTestModel: AXONHUB_OPENAI_DEFAULT_TEST_MODEL,
    manualModels: EXPECTED_AXONHUB_OPENAI_MODELS,
    autoSyncSupportedModels: false,
    autoSyncModelPattern: "",
    settings: EXPECTED_AXONHUB_CHANNEL_SETTINGS,
    tags: [],
    remark: "Managed by Asset-Attachments",
  });
});

test("buildAxonHubChannelInput uses the fixed codex channel format", () => {
  const input = buildAxonHubChannelInput({
    provider: "codex",
    projectOrigin: "https://proxy.example:8443/",
    proxyKey: "sk-proxy-test",
  });

  assert.deepEqual(input, {
    type: "codex",
    name: "proxy",
    baseURL: "https://proxy.example:8443/api/openai",
    credentials: {
      apiKey: "sk-proxy-test",
    },
    supportedModels: EXPECTED_AXONHUB_CODEX_MODELS,
    defaultTestModel: AXONHUB_CODEX_DEFAULT_TEST_MODEL,
    manualModels: EXPECTED_AXONHUB_CODEX_MODELS,
    autoSyncSupportedModels: false,
    autoSyncModelPattern: "",
    settings: EXPECTED_AXONHUB_CHANNEL_SETTINGS,
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
    settings: EXPECTED_AXONHUB_CHANNEL_SETTINGS,
    tags: [],
    remark: "Managed by Asset-Attachments",
  });
});

test("pickAxonHubChannelProvider only counts managed enabled channels toward the minimum enabled floor", () => {
  const provider = pickAxonHubChannelProvider([
    ...managedProviderChannels("anthropic", 10, { startIndex: 1 }),
    ...managedProviderChannels("openrouter", 9, { startIndex: 101 }),
    ...managedProviderChannels("gemini", 10, { startIndex: 201 }),
    ...managedProviderChannels("openai", 10, { startIndex: 301 }),
    ...managedProviderChannels("codex", 10, { startIndex: 401 }),
    managedChannel({
      id: "gid://axonhub/Channel/999",
      type: "openrouter",
      baseURL: "https://disabled-openrouter.example/api/openrouter",
      status: "disabled",
    }),
    managedChannel({
      id: "gid://axonhub/Channel/1000",
      type: "openrouter",
      baseURL: "https://external-openrouter.example/api/openrouter",
      status: "enabled",
      remark: "External channel",
    }),
  ]);

  assert.equal(provider, "openrouter");
});

test("pickAxonHubChannelProvider breaks minimum enabled floor ties by archived demand", () => {
  const provider = pickAxonHubChannelProvider([
    ...managedProviderChannels("anthropic", 8, { startIndex: 1 }),
    ...managedProviderChannels("openrouter", 8, { startIndex: 101 }),
    ...managedProviderChannels("gemini", 10, { startIndex: 201 }),
    ...managedProviderChannels("openai", 10, { startIndex: 301 }),
    ...managedProviderChannels("codex", 10, { startIndex: 601 }),
    ...managedProviderChannels("anthropic", 5, {
      status: "archived",
      startIndex: 401,
    }),
    ...managedProviderChannels("openrouter", 30, {
      status: "archived",
      startIndex: 501,
    }),
  ]);

  assert.equal(provider, "openrouter");
});

test("pickAxonHubChannelProvider can still choose anthropic after floors are met when it carries the most archived share", () => {
  const provider = pickAxonHubChannelProvider([
    ...managedProviderChannels("anthropic", 10, { startIndex: 1 }),
    ...managedProviderChannels("openrouter", 10, { startIndex: 101 }),
    ...managedProviderChannels("gemini", 10, { startIndex: 201 }),
    ...managedProviderChannels("openai", 10, { startIndex: 301 }),
    ...managedProviderChannels("codex", 10, { startIndex: 801 }),
    ...managedProviderChannels("anthropic", 60, {
      status: "archived",
      startIndex: 401,
    }),
    ...managedProviderChannels("openrouter", 20, {
      status: "archived",
      startIndex: 501,
    }),
    ...managedProviderChannels("gemini", 20, {
      status: "archived",
      startIndex: 601,
    }),
    ...managedProviderChannels("codex", 20, {
      status: "archived",
      startIndex: 901,
    }),
  ]);

  assert.equal(provider, "anthropic");
});

test("pickAxonHubChannelProvider prefers the provider whose archived share most exceeds its enabled share", () => {
  const provider = pickAxonHubChannelProvider([
    ...managedProviderChannels("anthropic", 16, { startIndex: 1 }),
    ...managedProviderChannels("openrouter", 18, { startIndex: 101 }),
    ...managedProviderChannels("gemini", 14, { startIndex: 201 }),
    ...managedProviderChannels("openai", 16, { startIndex: 301 }),
    ...managedProviderChannels("codex", 16, { startIndex: 801 }),
    ...managedProviderChannels("anthropic", 20, {
      status: "archived",
      startIndex: 401,
    }),
    ...managedProviderChannels("openrouter", 80, {
      status: "archived",
      startIndex: 501,
    }),
    ...managedProviderChannels("gemini", 10, {
      status: "archived",
      startIndex: 601,
    }),
    ...managedProviderChannels("openai", 10, {
      status: "archived",
      startIndex: 701,
    }),
    ...managedProviderChannels("codex", 10, {
      status: "archived",
      startIndex: 901,
    }),
  ]);

  assert.equal(provider, "openrouter");
});

test("pickAxonHubChannelProvider falls back to the fewest enabled channels when there is no archived signal yet", () => {
  const provider = pickAxonHubChannelProvider([
    ...managedProviderChannels("anthropic", 12, { startIndex: 1 }),
    ...managedProviderChannels("openrouter", 10, { startIndex: 101 }),
    ...managedProviderChannels("gemini", 11, { startIndex: 201 }),
    ...managedProviderChannels("openai", 9, { startIndex: 301 }),
    ...managedProviderChannels("codex", 10, { startIndex: 401 }),
  ]);

  assert.equal(provider, "openai");
});

test("pickAxonHubChannelProvider normalizes title-cased provider and status values from AxonHub before counting", () => {
  const provider = pickAxonHubChannelProvider([
    ...managedProviderChannels("anthropic", 10, {
      startIndex: 1,
      titleCaseType: true,
      titleCaseStatus: true,
    }),
    ...managedProviderChannels("openrouter", 10, {
      startIndex: 101,
      titleCaseType: true,
      titleCaseStatus: true,
    }),
    ...managedProviderChannels("gemini", 10, {
      startIndex: 201,
      titleCaseType: true,
      titleCaseStatus: true,
    }),
    ...managedProviderChannels("openai", 10, {
      startIndex: 301,
      titleCaseType: true,
      titleCaseStatus: true,
    }),
    ...managedProviderChannels("codex", 10, {
      startIndex: 501,
      titleCaseType: true,
      titleCaseStatus: true,
    }),
    ...managedProviderChannels("openrouter", 15, {
      status: "archived",
      startIndex: 601,
      titleCaseType: true,
      titleCaseStatus: true,
    }),
  ]);

  assert.equal(provider, "openrouter");
});

test("syncAxonHubChannel creates a new openai channel when openai is below the minimum enabled floor", async () => {
  const calls: Array<{ input: FetchInput; init?: RequestInit }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    calls.push({ input, init });

    const body = JSON.parse(String(init?.body ?? "{}")) as {
      query?: string;
    };

    if (body.query?.includes("query SyncAxonHubChannelLookup")) {
      return jsonResponse({
        data: {
          queryChannels: {
            edges: [
              ...managedProviderChannels("anthropic", 10).map((node) => ({ node })),
              ...managedProviderChannels("openrouter", 10, { startIndex: 101 }).map((node) => ({ node })),
              ...managedProviderChannels("gemini", 10, { startIndex: 201 }).map((node) => ({ node })),
              ...managedProviderChannels("openai", 9, { startIndex: 301 }).map((node) => ({ node })),
              ...managedProviderChannels("codex", 10, { startIndex: 401 }).map((node) => ({ node })),
            ],
          },
        },
      });
    }

    if (body.query?.includes("mutation CreateChannel")) {
      return jsonResponse({
        data: {
          createChannel: {
            id: "gid://axonhub/Channel/199",
            name: "proxy",
            type: "openai",
            baseURL: "https://proxy.example/api/openai",
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
  assert.equal(result.provider, "openai");
  assert.equal(result.channel.id, "gid://axonhub/Channel/199");
  assert.equal(calls.length, 2);

  const createBody = JSON.parse(String(calls[1]?.init?.body ?? "{}")) as {
    variables?: {
      input?: unknown;
    };
  };

  assert.deepEqual(createBody.variables?.input, {
    type: "openai",
    name: "proxy",
    baseURL: "https://proxy.example/api/openai",
    credentials: {
      apiKey: "sk-proxy-test",
    },
    supportedModels: AXONHUB_OPENAI_SUPPORTED_MODELS,
    defaultTestModel: AXONHUB_OPENAI_DEFAULT_TEST_MODEL,
    manualModels: AXONHUB_OPENAI_SUPPORTED_MODELS,
    autoSyncSupportedModels: false,
    autoSyncModelPattern: "",
    settings: EXPECTED_AXONHUB_CHANNEL_SETTINGS,
    tags: [],
    remark: "Managed by Asset-Attachments",
  });
});

test("syncAxonHubChannel creates a new codex channel when codex is below the minimum enabled floor", async () => {
  const calls: Array<{ input: FetchInput; init?: RequestInit }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    calls.push({ input, init });

    const body = JSON.parse(String(init?.body ?? "{}")) as {
      query?: string;
    };

    if (body.query?.includes("query SyncAxonHubChannelLookup")) {
      return jsonResponse({
        data: {
          queryChannels: {
            edges: [
              ...managedProviderChannels("anthropic", 10).map((node) => ({ node })),
              ...managedProviderChannels("openrouter", 10, { startIndex: 101 }).map((node) => ({ node })),
              ...managedProviderChannels("gemini", 10, { startIndex: 201 }).map((node) => ({ node })),
              ...managedProviderChannels("openai", 10, { startIndex: 301 }).map((node) => ({ node })),
              ...managedProviderChannels("codex", 9, { startIndex: 401 }).map((node) => ({ node })),
            ],
          },
        },
      });
    }

    if (body.query?.includes("mutation CreateChannel")) {
      return jsonResponse({
        data: {
          createChannel: {
            id: "gid://axonhub/Channel/299",
            name: "proxy",
            type: "codex",
            baseURL: "https://proxy.example/api/openai",
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
  assert.equal(result.provider, "codex");
  assert.equal(result.channel.id, "gid://axonhub/Channel/299");
  assert.equal(calls.length, 2);

  const createBody = JSON.parse(String(calls[1]?.init?.body ?? "{}")) as {
    variables?: {
      input?: unknown;
    };
  };

  assert.deepEqual(createBody.variables?.input, {
    type: "codex",
    name: "proxy",
    baseURL: "https://proxy.example/api/openai",
    credentials: {
      apiKey: "sk-proxy-test",
    },
    supportedModels: AXONHUB_CODEX_SUPPORTED_MODELS,
    defaultTestModel: AXONHUB_CODEX_DEFAULT_TEST_MODEL,
    manualModels: AXONHUB_CODEX_SUPPORTED_MODELS,
    autoSyncSupportedModels: false,
    autoSyncModelPattern: "",
    settings: EXPECTED_AXONHUB_CHANNEL_SETTINGS,
    tags: [],
    remark: "Managed by Asset-Attachments",
  });
});

test("syncAxonHubChannel creates a new anthropic channel when anthropic is below the minimum enabled floor", async () => {
  const calls: Array<{ input: FetchInput; init?: RequestInit }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    calls.push({ input, init });

    const body = JSON.parse(String(init?.body ?? "{}")) as {
      query?: string;
    };

    if (body.query?.includes("query SyncAxonHubChannelLookup")) {
      return jsonResponse({
        data: {
          queryChannels: {
            edges: [
              ...managedProviderChannels("anthropic", 9).map((node) => ({ node })),
              ...managedProviderChannels("openrouter", 10, { startIndex: 101 }).map((node) => ({ node })),
              ...managedProviderChannels("gemini", 10, { startIndex: 201 }).map((node) => ({ node })),
              ...managedProviderChannels("openai", 10, { startIndex: 301 }).map((node) => ({ node })),
              ...managedProviderChannels("codex", 10, { startIndex: 401 }).map((node) => ({ node })),
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
    settings: EXPECTED_AXONHUB_CHANNEL_SETTINGS,
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
              ...managedProviderChannels("anthropic", 8).map((node) => ({ node })),
              {
                node: managedChannel({
                  id: "gid://axonhub/Channel/70",
                  type: "anthropic",
                  baseURL: "https://proxy.example/api/anthropic",
                  status: "enabled",
                }),
              },
              ...managedProviderChannels("openrouter", 10, { startIndex: 101 }).map((node) => ({ node })),
              ...managedProviderChannels("gemini", 10, { startIndex: 201 }).map((node) => ({ node })),
              ...managedProviderChannels("openai", 10, { startIndex: 301 }).map((node) => ({ node })),
              ...managedProviderChannels("codex", 10, { startIndex: 401 }).map((node) => ({ node })),
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
  assert.equal(result.channel.id, "gid://axonhub/Channel/70");
  assert.equal(calls.length, 2);

  const updateBody = JSON.parse(String(calls[1]?.init?.body ?? "{}")) as {
    variables?: {
      id?: string;
      input?: unknown;
    };
  };

  assert.equal(updateBody.variables?.id, "gid://axonhub/Channel/70");
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
    settings: EXPECTED_AXONHUB_CHANNEL_SETTINGS,
    tags: [],
    remark: "Managed by Asset-Attachments",
  });
});

test("syncAxonHubChannel updates the existing anthropic channel when AxonHub returns title-cased provider and status values", async () => {
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
              ...managedProviderChannels("anthropic", 8, {
                startIndex: 1,
                titleCaseType: true,
                titleCaseStatus: true,
              }).map((node) => ({ node })),
              {
                node: managedChannel({
                  id: "gid://axonhub/Channel/70",
                  type: "Anthropic",
                  baseURL: "https://proxy.example/api/anthropic",
                  status: "Enabled",
                }),
              },
              ...managedProviderChannels("openrouter", 10, {
                startIndex: 101,
                titleCaseType: true,
                titleCaseStatus: true,
              }).map((node) => ({ node })),
              ...managedProviderChannels("gemini", 10, {
                startIndex: 201,
                titleCaseType: true,
                titleCaseStatus: true,
              }).map((node) => ({ node })),
              ...managedProviderChannels("openai", 10, {
                startIndex: 301,
                titleCaseType: true,
                titleCaseStatus: true,
              }).map((node) => ({ node })),
              ...managedProviderChannels("codex", 10, {
                startIndex: 401,
                titleCaseType: true,
                titleCaseStatus: true,
              }).map((node) => ({ node })),
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
            status: "Enabled",
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
  assert.equal(result.channel.id, "gid://axonhub/Channel/70");
  assert.equal(calls.length, 2);

  const updateBody = JSON.parse(String(calls[1]?.init?.body ?? "{}")) as {
    variables?: {
      id?: string;
      input?: unknown;
    };
  };

  assert.equal(updateBody.variables?.id, "gid://axonhub/Channel/70");
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
    settings: EXPECTED_AXONHUB_CHANNEL_SETTINGS,
    tags: [],
    remark: "Managed by Asset-Attachments",
  });
});

test("syncAxonHubChannel creates a new gemini channel when gemini has the strongest archived-share gap", async () => {
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
              ...managedProviderChannels("anthropic", 14).map((node) => ({ node })),
              ...managedProviderChannels("openrouter", 14, { startIndex: 101 }).map((node) => ({ node })),
              ...managedProviderChannels("gemini", 10, { startIndex: 201 }).map((node) => ({ node })),
              ...managedProviderChannels("openai", 14, { startIndex: 301 }).map((node) => ({ node })),
              ...managedProviderChannels("codex", 14, { startIndex: 801 }).map((node) => ({ node })),
              ...managedProviderChannels("anthropic", 20, {
                status: "archived",
                startIndex: 401,
              }).map((node) => ({ node })),
              ...managedProviderChannels("openrouter", 10, {
                status: "archived",
                startIndex: 501,
              }).map((node) => ({ node })),
              ...managedProviderChannels("gemini", 70, {
                status: "archived",
                startIndex: 601,
              }).map((node) => ({ node })),
              ...managedProviderChannels("openai", 10, {
                status: "archived",
                startIndex: 701,
              }).map((node) => ({ node })),
              ...managedProviderChannels("codex", 10, {
                status: "archived",
                startIndex: 901,
              }).map((node) => ({ node })),
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
    settings: EXPECTED_AXONHUB_CHANNEL_SETTINGS,
    tags: [],
    remark: "Managed by Asset-Attachments",
  });
});

test("syncAxonHubChannel creates a new openrouter channel when openrouter is below the minimum enabled floor", async () => {
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
              ...managedProviderChannels("anthropic", 10).map((node) => ({ node })),
              ...managedProviderChannels("openrouter", 9, { startIndex: 101 }).map((node) => ({ node })),
              ...managedProviderChannels("gemini", 10, { startIndex: 201 }).map((node) => ({ node })),
              ...managedProviderChannels("openai", 10, { startIndex: 301 }).map((node) => ({ node })),
              ...managedProviderChannels("codex", 10, { startIndex: 401 }).map((node) => ({ node })),
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
    settings: EXPECTED_AXONHUB_CHANNEL_SETTINGS,
    tags: [],
    remark: "Managed by Asset-Attachments",
  });
});
