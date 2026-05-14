import type {
  ProviderExecutionResult,
  ProviderPipeOptions,
  ProviderResponseSink,
} from "./types";

function isClosed(sink: ProviderResponseSink): boolean {
  return sink.isClosed?.() ?? false;
}

async function writeChunk(
  sink: ProviderResponseSink,
  chunk: Uint8Array | string,
): Promise<void> {
  if (!isClosed(sink)) {
    await sink.write(chunk);
  }
}

async function endSink(sink: ProviderResponseSink): Promise<void> {
  if (!isClosed(sink)) {
    await sink.end();
  }
}

function startKeepAlive(
  options: ProviderPipeOptions | undefined,
  sink: ProviderResponseSink,
): NodeJS.Timeout | undefined {
  if (!options?.keepaliveIntervalMs || options.keepaliveIntervalMs <= 0) {
    return undefined;
  }

  const keepaliveChunk = options.keepaliveChunk ?? "\n";
  const timer = setInterval(() => {
    void writeChunk(sink, keepaliveChunk);
  }, options.keepaliveIntervalMs);

  timer.unref?.();
  return timer;
}

function toUint8Array(chunk: Uint8Array | string): Uint8Array {
  return typeof chunk === "string"
    ? Buffer.from(chunk, "utf8")
    : chunk;
}

export function createBufferedExecutionResult(params: {
  status: number;
  contentType: string;
  readBody: () => Promise<Uint8Array>;
}): ProviderExecutionResult {
  let cachedBody: Uint8Array | undefined;
  let bodyPromise: Promise<Uint8Array> | undefined;

  const getBody = async (): Promise<Uint8Array> => {
    if (cachedBody) {
      return cachedBody;
    }

    if (!bodyPromise) {
      bodyPromise = params.readBody().then((body) => {
        cachedBody = body;
        return body;
      });
    }

    return await bodyPromise;
  };

  return {
    status: params.status,
    contentType: params.contentType,
    stream: false,
    readBody: getBody,
    pipeToSink: async (sink, options) => {
      const keepalive = startKeepAlive(options, sink);

      try {
        const body = await getBody();
        await writeChunk(sink, body);
        await endSink(sink);
      } finally {
        if (keepalive) {
          clearInterval(keepalive);
        }
      }
    },
  };
}

export function createStreamExecutionResult(params: {
  status: number;
  contentType: string;
  pipeToSink: (
    sink: ProviderResponseSink,
    options?: ProviderPipeOptions,
  ) => Promise<void>;
}): ProviderExecutionResult {
  return {
    status: params.status,
    contentType: params.contentType,
    stream: true,
    readBody: async () => {
      const chunks: Uint8Array[] = [];
      await params.pipeToSink({
        write: async (chunk) => {
          chunks.push(toUint8Array(chunk));
        },
        end: async () => {},
      });

      return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    },
    pipeToSink: async (sink, options) => {
      await params.pipeToSink(sink, options);
    },
  };
}

export function encodeExecutionPayload(
  value: unknown,
): Uint8Array {
  if (typeof value === "string") {
    return Buffer.from(value, "utf8");
  }

  return Buffer.from(JSON.stringify(value), "utf8");
}
