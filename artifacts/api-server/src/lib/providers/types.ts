export type ProviderExecutionLogger = {
  info: (bindings: unknown, message?: string) => void;
  warn: (bindings: unknown, message?: string) => void;
  error: (bindings: unknown, message?: string) => void;
  debug: (bindings: unknown, message?: string) => void;
  child?: (bindings: Record<string, unknown>) => ProviderExecutionLogger;
};

export type ProviderExecutionRequest = {
  method: string;
  path: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
};

export type ProviderResponseSink = {
  write: (chunk: Uint8Array | string) => Promise<void> | void;
  end: () => Promise<void> | void;
  isClosed?: () => boolean;
};

export type ProviderPipeOptions = {
  keepaliveIntervalMs?: number;
  keepaliveChunk?: string;
};

export type ProviderExecutionResult = {
  status: number;
  contentType: string;
  stream: boolean;
  readBody: () => Promise<Uint8Array>;
  pipeToSink: (
    sink: ProviderResponseSink,
    options?: ProviderPipeOptions,
  ) => Promise<void>;
};
