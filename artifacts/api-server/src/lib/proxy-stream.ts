export type ProxyStreamConfig = {
  streamKeepaliveIntervalMs: number;
  nonStreamKeepaliveIntervalMs: number;
  streamBootstrapRetries: number;
};

type StreamReadResult = Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>;

class EmptyUpstreamStreamBootstrapError extends Error {
  constructor() {
    super("Upstream stream ended before the first chunk.");
    this.name = "EmptyUpstreamStreamBootstrapError";
  }
}

export type PreparedProxyUpstream = {
  upstream: globalThis.Response;
  contentType: string;
  isStream: boolean;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
  firstReadPromise?: Promise<StreamReadResult>;
};

function parseSeconds(
  rawValue: string | undefined,
  defaultSeconds: number,
): number {
  if (rawValue === undefined) {
    return defaultSeconds;
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) {
    return defaultSeconds;
  }

  return value;
}

function parseRetries(
  rawValue: string | undefined,
  defaultRetries: number,
): number {
  if (rawValue === undefined) {
    return defaultRetries;
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) {
    return defaultRetries;
  }

  return Math.floor(value);
}

export function isStreamingContentType(contentType: string): boolean {
  return contentType.includes("text/event-stream") || contentType.includes("application/stream");
}

export function getProxyStreamConfig(): ProxyStreamConfig {
  return {
    streamKeepaliveIntervalMs: Math.round(
      parseSeconds(process.env.PROXY_STREAM_KEEPALIVE_SECONDS, 0) * 1000,
    ),
    nonStreamKeepaliveIntervalMs: Math.round(
      parseSeconds(process.env.PROXY_NON_STREAM_KEEPALIVE_INTERVAL_SECONDS, 0) * 1000,
    ),
    streamBootstrapRetries: parseRetries(process.env.PROXY_STREAM_BOOTSTRAP_RETRIES, 0),
  };
}

export async function withBootstrapRetries<T>(
  operation: (attempt: number) => Promise<T>,
  options: {
    retries: number;
    onRetry?: (attempt: number, error: unknown) => void;
  },
): Promise<T> {
  let attempt = 0;

  for (;;) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= options.retries) {
        throw error;
      }

      attempt += 1;
      options.onRetry?.(attempt, error);
    }
  }
}

export async function prepareProxyUpstream(params: {
  execute: () => Promise<globalThis.Response>;
  wantsStream: boolean;
  bootstrapRetries: number;
  onRetry?: (attempt: number, error: unknown) => void;
}): Promise<PreparedProxyUpstream> {
  return await withBootstrapRetries(async () => {
    const upstream = await params.execute();
    const contentType = upstream.headers.get("content-type") || "application/json";
    const isStream = isStreamingContentType(contentType);

    if (!params.wantsStream || !upstream.ok || !isStream || !upstream.body) {
      return {
        upstream,
        contentType,
        isStream: isStream && !!upstream.body,
      };
    }

    const reader = upstream.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    let firstReadResult: StreamReadResult | undefined;
    let firstReadError: unknown;
    const firstReadPromise = reader.read().then(
      (result) => {
        firstReadResult = result;
        return result;
      },
      (error) => {
        firstReadError = error;
        throw error;
      },
    );

    // Allow an already-closed upstream stream to settle without delaying
    // keepalive writes for healthy streams that simply have not produced their
    // first chunk yet.
    await Promise.resolve();

    if (firstReadError !== undefined) {
      reader.releaseLock?.();
      throw firstReadError;
    }

    if (firstReadResult?.done) {
      reader.releaseLock?.();
      throw new EmptyUpstreamStreamBootstrapError();
    }

    return {
      upstream,
      contentType,
      isStream: true,
      reader,
      firstReadPromise,
    };
  }, {
    retries: params.wantsStream ? params.bootstrapRetries : 0,
    onRetry: params.onRetry,
  });
}
