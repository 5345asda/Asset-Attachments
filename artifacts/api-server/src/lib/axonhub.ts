export const AXONHUB_ORIGIN = "https://axonhub.qwqtao.com";
export const AXONHUB_DEFAULT_TEST_MODEL = "claude-opus-4-5";
export const AXONHUB_SUPPORTED_MODELS = [
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-opus-4-5",
  "claude-sonnet-4-6",
] as const;
export const AXONHUB_GEMINI_DEFAULT_TEST_MODEL = "gemini-2.5-flash";
export const AXONHUB_GEMINI_SUPPORTED_MODELS = [
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3-pro-image-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-image",
] as const;
export const AXONHUB_OPENROUTER_DEFAULT_TEST_MODEL = "z-ai/glm-4.7";
export const AXONHUB_OPENROUTER_SUPPORTED_MODELS = [
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

const AXONHUB_GRAPHQL_URL = `${AXONHUB_ORIGIN}/admin/graphql`;
const AXONHUB_REMARK = "Managed by Asset-Attachments";
const AXONHUB_MIN_ENABLED_CHANNELS = 10;
const AXONHUB_PROVIDER_ORDER: readonly AxonHubProvider[] = [
  "anthropic",
  "openrouter",
  "gemini",
];
const AXONHUB_LOOKUP_PAGE_SIZE = 100;

const LOOKUP_CHANNELS_QUERY = `
  query SyncAxonHubChannelLookup($input: QueryChannelInput!) {
    queryChannels(input: $input) {
      edges {
        node {
          id
          name
          type
          baseURL
          remark
          status
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const CREATE_CHANNEL_MUTATION = `
  mutation CreateChannel($input: CreateChannelInput!) {
    createChannel(input: $input) {
      id
      name
      baseURL
      status
    }
  }
`;

const UPDATE_CHANNEL_MUTATION = `
  mutation UpdateChannel($id: ID!, $input: UpdateChannelInput!) {
    updateChannel(id: $id, input: $input) {
      id
      name
      baseURL
      status
    }
  }
`;

interface GraphQlChannelNode {
  id: string;
  name: string;
  type?: AxonHubProvider | string | null;
  baseURL: string;
  remark?: string | null;
  status?: string | null;
}

interface SyncLookupResponse {
  queryChannels?: {
    edges?: Array<{
      node?: GraphQlChannelNode | null;
    }>;
    pageInfo?: {
      hasNextPage?: boolean | null;
      endCursor?: string | null;
    };
  };
}

interface CreateChannelResponse {
  createChannel?: GraphQlChannelNode;
}

interface UpdateChannelResponse {
  updateChannel?: GraphQlChannelNode;
}

interface BuildAxonHubChannelInputOptions {
  provider: AxonHubProvider;
  projectOrigin: string;
  proxyKey: string;
}

export interface SyncAxonHubChannelOptions {
  projectOrigin: string;
  proxyKey: string;
  adminToken: string;
  fetchImpl?: typeof fetch;
}

export interface SyncAxonHubChannelResult {
  mode: "created" | "updated";
  provider: AxonHubProvider;
  channel: GraphQlChannelNode;
}

export type AxonHubProvider = "anthropic" | "gemini" | "openrouter";

interface AxonHubProviderStats {
  provider: AxonHubProvider;
  enabledCount: number;
  archivedCount: number;
}

function normalizeAxonHubProviderType(type?: string | null): AxonHubProvider | null {
  if (!type) {
    return null;
  }

  const normalized = type.trim().toLowerCase();

  if (
    normalized === "anthropic"
    || normalized === "gemini"
    || normalized === "openrouter"
  ) {
    return normalized;
  }

  return null;
}

function normalizeAxonHubChannelStatus(status?: string | null): "enabled" | "archived" | null {
  if (!status) {
    return null;
  }

  const normalized = status.trim().toLowerCase();

  if (normalized === "enabled" || normalized === "archived") {
    return normalized;
  }

  return null;
}

interface AxonHubCreateChannelInput {
  type: AxonHubProvider;
  name: string;
  baseURL: string;
  credentials: {
    apiKey: string;
  };
  supportedModels: string[];
  defaultTestModel: string;
  manualModels: string[];
  autoSyncSupportedModels: false;
  autoSyncModelPattern: "";
  tags: string[];
  remark: string;
}

interface AxonHubUpdateChannelInput extends AxonHubCreateChannelInput {
  status: "enabled";
}

export class AxonHubSyncError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "AxonHubSyncError";
    this.status = status;
  }
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

function deriveChannelName(projectOrigin: string): string {
  const { hostname } = new URL(normalizeOrigin(projectOrigin));
  const firstLabel = hostname.split(".")[0]?.trim();

  if (!firstLabel) {
    return hostname;
  }

  return firstLabel;
}

export function normalizeAxonHubToken(token: string): string {
  const normalized = token.trim();

  if (!normalized) {
    throw new AxonHubSyncError("AxonHub token is required", 400);
  }

  return normalized.startsWith("Bearer ")
    ? normalized
    : `Bearer ${normalized}`;
}

export function buildAxonHubChannelInput({
  provider,
  projectOrigin,
  proxyKey,
}: BuildAxonHubChannelInputOptions): AxonHubCreateChannelInput {
  const normalizedOrigin = normalizeOrigin(projectOrigin);
  const supportedModels = provider === "gemini"
    ? [...AXONHUB_GEMINI_SUPPORTED_MODELS]
    : provider === "openrouter"
      ? [...AXONHUB_OPENROUTER_SUPPORTED_MODELS]
      : [...AXONHUB_SUPPORTED_MODELS];
  const defaultTestModel = provider === "gemini"
    ? AXONHUB_GEMINI_DEFAULT_TEST_MODEL
    : provider === "openrouter"
      ? AXONHUB_OPENROUTER_DEFAULT_TEST_MODEL
      : AXONHUB_DEFAULT_TEST_MODEL;

  return {
    type: provider,
    name: deriveChannelName(normalizedOrigin),
    baseURL: `${normalizedOrigin}/api/${provider}`,
    credentials: {
      apiKey: proxyKey,
    },
    supportedModels,
    defaultTestModel,
    manualModels: supportedModels,
    autoSyncSupportedModels: false,
    autoSyncModelPattern: "",
    tags: [],
    remark: AXONHUB_REMARK,
  };
}

export function pickAxonHubChannelProvider(
  channels: ReadonlyArray<GraphQlChannelNode | null | undefined>,
): AxonHubProvider {
  const stats = AXONHUB_PROVIDER_ORDER.map((provider) => ({
    provider,
    enabledCount: 0,
    archivedCount: 0,
  } satisfies AxonHubProviderStats));

  for (const channel of channels) {
    if (!channel || channel.remark !== AXONHUB_REMARK) {
      continue;
    }

    const provider = normalizeAxonHubProviderType(channel.type);
    const status = normalizeAxonHubChannelStatus(channel.status);

    if (!provider || !status) {
      continue;
    }

    const providerStats = stats.find((entry) => entry.provider === provider);

    if (!providerStats) {
      continue;
    }

    if (status === "enabled") {
      providerStats.enabledCount += 1;
      continue;
    }

    providerStats.archivedCount += 1;
  }

  const totals = stats.reduce(
    (aggregate, providerStats) => {
      return {
        enabledCount: aggregate.enabledCount + providerStats.enabledCount,
        archivedCount: aggregate.archivedCount + providerStats.archivedCount,
      };
    },
    {
      enabledCount: 0,
      archivedCount: 0,
    },
  );

  const getGap = (providerStats: AxonHubProviderStats): number => {
    const archivedShare = totals.archivedCount > 0
      ? providerStats.archivedCount / totals.archivedCount
      : 0;
    const enabledShare = totals.enabledCount > 0
      ? providerStats.enabledCount / totals.enabledCount
      : 0;

    return archivedShare - enabledShare;
  };

  const compareProviders = (
    left: AxonHubProviderStats,
    right: AxonHubProviderStats,
  ): number => {
    const gapDifference = getGap(right) - getGap(left);

    if (gapDifference !== 0) {
      return gapDifference;
    }

    const archivedCountDifference = right.archivedCount - left.archivedCount;

    if (archivedCountDifference !== 0) {
      return archivedCountDifference;
    }

    const enabledCountDifference = left.enabledCount - right.enabledCount;

    if (enabledCountDifference !== 0) {
      return enabledCountDifference;
    }

    return AXONHUB_PROVIDER_ORDER.indexOf(left.provider)
      - AXONHUB_PROVIDER_ORDER.indexOf(right.provider);
  };

  const belowMinimum = stats
    .filter((providerStats) => providerStats.enabledCount < AXONHUB_MIN_ENABLED_CHANNELS)
    .sort((left, right) => {
      const deficitDifference = (AXONHUB_MIN_ENABLED_CHANNELS - right.enabledCount)
        - (AXONHUB_MIN_ENABLED_CHANNELS - left.enabledCount);

      if (deficitDifference !== 0) {
        return deficitDifference;
      }

      return compareProviders(left, right);
    });

  if (belowMinimum.length > 0) {
    return belowMinimum[0]?.provider ?? "anthropic";
  }

  if (totals.archivedCount === 0) {
    return [...stats]
      .sort((left, right) => {
        const enabledCountDifference = left.enabledCount - right.enabledCount;

        if (enabledCountDifference !== 0) {
          return enabledCountDifference;
        }

        return AXONHUB_PROVIDER_ORDER.indexOf(left.provider)
          - AXONHUB_PROVIDER_ORDER.indexOf(right.provider);
      })[0]?.provider ?? "anthropic";
  }

  return [...stats].sort(compareProviders)[0]?.provider ?? "anthropic";
}

function buildAxonHubUpdateChannelInput(
  input: AxonHubCreateChannelInput,
): AxonHubUpdateChannelInput {
  return {
    ...input,
    status: "enabled",
  };
}

async function postGraphQl<TData>(
  query: string,
  variables: Record<string, unknown>,
  adminToken: string,
  fetchImpl: typeof fetch,
): Promise<TData> {
  const response = await fetchImpl(AXONHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: normalizeAxonHubToken(adminToken),
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  let payload: {
    data?: TData;
    errors?: Array<{
      message?: string;
    }>;
  };

  try {
    payload = await response.json() as typeof payload;
  } catch {
    throw new AxonHubSyncError("AxonHub returned a non-JSON response", 502);
  }

  if (!response.ok) {
    const message = payload.errors?.[0]?.message
      || `AxonHub request failed with status ${response.status}`;
    throw new AxonHubSyncError(message, response.status);
  }

  if (payload.errors?.length) {
    throw new AxonHubSyncError(
      payload.errors[0]?.message || "AxonHub GraphQL request failed",
      502,
    );
  }

  if (!payload.data) {
    throw new AxonHubSyncError("AxonHub returned an empty GraphQL payload", 502);
  }

  return payload.data;
}

export async function syncAxonHubChannel({
  projectOrigin,
  proxyKey,
  adminToken,
  fetchImpl = fetch,
}: SyncAxonHubChannelOptions): Promise<SyncAxonHubChannelResult> {
  const channels: Array<GraphQlChannelNode | null | undefined> = [];
  let after: string | undefined;
  let hasNextPage = true;

  while (hasNextPage) {
    const lookup = await postGraphQl<SyncLookupResponse>(
      LOOKUP_CHANNELS_QUERY,
      {
        input: {
          first: AXONHUB_LOOKUP_PAGE_SIZE,
          ...(after ? { after } : {}),
        },
      },
      adminToken,
      fetchImpl,
    );

    channels.push(...(lookup.queryChannels?.edges?.map((edge) => edge.node) ?? []));

    const pageInfo = lookup.queryChannels?.pageInfo;
    after = pageInfo?.endCursor || undefined;
    hasNextPage = pageInfo?.hasNextPage === true && !!after;
  }

  const provider = pickAxonHubChannelProvider(channels);
  const input = buildAxonHubChannelInput({
    provider,
    projectOrigin,
    proxyKey,
  });

  const existingChannel = channels
    .find((channel): channel is GraphQlChannelNode => {
      return !!channel
        && normalizeAxonHubProviderType(channel.type) === provider
        && channel.baseURL === input.baseURL;
    });

  if (existingChannel) {
    const updateInput = buildAxonHubUpdateChannelInput(input);

    const updated = await postGraphQl<UpdateChannelResponse>(
      UPDATE_CHANNEL_MUTATION,
      {
        id: existingChannel.id,
        input: updateInput,
      },
      adminToken,
      fetchImpl,
    );

    if (!updated.updateChannel) {
      throw new AxonHubSyncError("AxonHub did not return the updated channel", 502);
    }

    return {
      mode: "updated",
      provider,
      channel: updated.updateChannel,
    };
  }

  const created = await postGraphQl<CreateChannelResponse>(
    CREATE_CHANNEL_MUTATION,
    {
      input,
    },
    adminToken,
    fetchImpl,
  );

  if (!created.createChannel) {
    throw new AxonHubSyncError("AxonHub did not return the created channel", 502);
  }

  return {
    mode: "created",
    provider,
    channel: created.createChannel,
  };
}
