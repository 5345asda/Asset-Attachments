export const AXONHUB_ORIGIN = "https://axonhub.qwqtao.com";
export const AXONHUB_DEFAULT_TEST_MODEL = "claude-opus-4-5";
export const AXONHUB_SUPPORTED_MODELS = [
  "claude-opus-4-6",
  "claude-opus-4-5",
  "claude-sonnet-4-6",
] as const;

const AXONHUB_GRAPHQL_URL = `${AXONHUB_ORIGIN}/admin/graphql`;
const AXONHUB_REMARK = "Managed by Asset-Attachments";

const LOOKUP_CHANNELS_QUERY = `
  query SyncAxonHubChannelLookup($input: QueryChannelInput!) {
    queryChannels(input: $input) {
      edges {
        node {
          id
          name
          baseURL
        }
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
  baseURL: string;
  status?: string | null;
}

interface SyncLookupResponse {
  queryChannels?: {
    edges?: Array<{
      node?: GraphQlChannelNode | null;
    }>;
  };
}

interface CreateChannelResponse {
  createChannel?: GraphQlChannelNode;
}

interface UpdateChannelResponse {
  updateChannel?: GraphQlChannelNode;
}

interface BuildAxonHubChannelInputOptions {
  projectOrigin: string;
  proxyKey: string;
}

export interface SyncAxonHubChannelOptions extends BuildAxonHubChannelInputOptions {
  adminToken: string;
  fetchImpl?: typeof fetch;
}

export interface SyncAxonHubChannelResult {
  mode: "created" | "updated";
  channel: GraphQlChannelNode;
}

interface AxonHubChannelInput {
  type: "anthropic";
  name: string;
  baseURL: string;
  status: "enabled";
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
  projectOrigin,
  proxyKey,
}: BuildAxonHubChannelInputOptions): AxonHubChannelInput {
  const normalizedOrigin = normalizeOrigin(projectOrigin);

  return {
    type: "anthropic",
    name: deriveChannelName(normalizedOrigin),
    baseURL: `${normalizedOrigin}/api/anthropic`,
    status: "enabled",
    credentials: {
      apiKey: proxyKey,
    },
    supportedModels: [...AXONHUB_SUPPORTED_MODELS],
    defaultTestModel: AXONHUB_DEFAULT_TEST_MODEL,
    manualModels: [...AXONHUB_SUPPORTED_MODELS],
    autoSyncSupportedModels: false,
    autoSyncModelPattern: "",
    tags: [],
    remark: AXONHUB_REMARK,
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
  const input = buildAxonHubChannelInput({
    projectOrigin,
    proxyKey,
  });

  const lookup = await postGraphQl<SyncLookupResponse>(
    LOOKUP_CHANNELS_QUERY,
    {
      input: {
        first: 100,
      },
    },
    adminToken,
    fetchImpl,
  );

  const existingChannel = lookup.queryChannels?.edges
    ?.map((edge) => edge.node)
    .find((channel): channel is GraphQlChannelNode => {
      return !!channel && channel.baseURL === input.baseURL;
    });

  if (existingChannel) {
    const updated = await postGraphQl<UpdateChannelResponse>(
      UPDATE_CHANNEL_MUTATION,
      {
        id: existingChannel.id,
        input,
      },
      adminToken,
      fetchImpl,
    );

    if (!updated.updateChannel) {
      throw new AxonHubSyncError("AxonHub did not return the updated channel", 502);
    }

    return {
      mode: "updated",
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
    channel: created.createChannel,
  };
}
