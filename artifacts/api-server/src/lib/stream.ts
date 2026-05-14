import type { Response } from "express";
import { applyBillingAnthropic } from "./billing";
import { normalizeAnthropicStreamEvent } from "./anthropic-message-id";
import {
  createAnthropicStructuredOutputEventTransformer,
  type AnthropicStructuredOutputShim,
} from "./anthropic-structured-output";
import { logger } from "./logger";
import type { ProviderPipeOptions, ProviderResponseSink } from "./providers/types";

type StreamReadResult = Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>;

type StreamPipeOptions = {
  firstChunk?: Uint8Array;
  firstReadPromise?: Promise<StreamReadResult>;
  streamDone?: boolean;
};

function isClosed(sink: ProviderResponseSink): boolean {
  return sink.isClosed?.() ?? false;
}

async function writeToSink(
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

function writeKeepAlive(res: Response): void {
  if (!res.destroyed) {
    res.write(": ping\n\n");
  }
}

function writeWhitespaceKeepAlive(res: Response): void {
  if (!res.destroyed) {
    res.write("\n");
  }
}

function startKeepAlive(
  intervalMs: number | undefined,
  callback: () => void,
): NodeJS.Timeout | undefined {
  if (!intervalMs || intervalMs <= 0) {
    return undefined;
  }

  const keepalive = setInterval(callback, intervalMs);
  keepalive.unref?.();
  return keepalive;
}

function toResponseSink(res: Response): ProviderResponseSink {
  return {
    write: async (chunk) => {
      if (!res.destroyed) {
        res.write(chunk);
      }
    },
    end: async () => {
      if (!res.destroyed) {
        res.end();
      }
    },
    isClosed: () => res.destroyed,
  };
}

export async function pipeReaderToSink(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  sink: ProviderResponseSink,
  options?: StreamPipeOptions & ProviderPipeOptions,
): Promise<void> {
  const keepalive = startKeepAlive(options?.keepaliveIntervalMs, () => {
    void writeToSink(sink, options?.keepaliveChunk ?? ": ping\n\n");
  });

  try {
    let initialRead: StreamReadResult | undefined;

    if (options?.firstReadPromise) {
      initialRead = await options.firstReadPromise;
    }

    if (options?.firstChunk) {
      await writeToSink(sink, options.firstChunk);
    } else if (initialRead && !initialRead.done && initialRead.value) {
      await writeToSink(sink, initialRead.value);
    }

    const streamDone = options?.streamDone ?? initialRead?.done ?? false;
    if (!streamDone) {
      for (;;) {
        if (isClosed(sink)) {
          reader.cancel().catch(() => {});
          break;
        }

        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        await writeToSink(sink, value);
      }
    }

    await endSink(sink);
  } finally {
    if (keepalive) {
      clearInterval(keepalive);
    }
    reader.releaseLock?.();
  }
}

export async function pipeReaderToResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  res: Response,
  options?: StreamPipeOptions & {
    keepaliveIntervalMs?: number;
  },
): Promise<void> {
  await pipeReaderToSink(reader, toResponseSink(res), {
    ...options,
    keepaliveChunk: ": ping\n\n",
  });
}

export async function pipeAnthropicStreamWithUsageAdjustToSink(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  sink: ProviderResponseSink,
  options?: StreamPipeOptions & ProviderPipeOptions & {
    structuredOutputShim?: AnthropicStructuredOutputShim;
  },
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  const transformEvent = createAnthropicStructuredOutputEventTransformer(options?.structuredOutputShim);

  const writeLine = async (line: string): Promise<void> => {
    if (!line.startsWith("data: ")) {
      await writeToSink(sink, `${line}\n`);
      return;
    }

    const raw = line.slice(6).trim();
    if (!raw || raw === "[DONE]") {
      await writeToSink(sink, `${line}\n`);
      return;
    }

    try {
      const event = JSON.parse(raw) as Record<string, any>;

      if (event.type === "message_start" && event.message?.usage) {
        const rawUsage = event.message.usage;
        logger.info(
          {
            input_tokens: rawUsage.input_tokens,
            cache_creation_input_tokens: rawUsage.cache_creation_input_tokens ?? 0,
            cache_read_input_tokens: rawUsage.cache_read_input_tokens ?? 0,
            event: "message_start",
          },
          "Anthropic raw usage (before billing adjustment)",
        );

        const adjustedUsage = applyBillingAnthropic(rawUsage);
        event.message.usage = adjustedUsage;

        logger.info(
          {
            input_tokens: adjustedUsage.input_tokens,
            cache_creation_input_tokens: adjustedUsage.cache_creation_input_tokens ?? 0,
            cache_read_input_tokens: adjustedUsage.cache_read_input_tokens ?? 0,
            event: "message_start",
          },
          "Anthropic adjusted usage (after billing, sent to client)",
        );
      } else if (
        event.type === "message_delta"
        && event.usage
        && (
          event.usage.cache_read_input_tokens
          || event.usage.input_tokens
          || event.usage.cache_creation_input_tokens
        )
      ) {
        logger.info(
          {
            input_tokens: event.usage.input_tokens ?? 0,
            cache_creation_input_tokens: event.usage.cache_creation_input_tokens ?? 0,
            cache_read_input_tokens: event.usage.cache_read_input_tokens ?? 0,
            event: "message_delta",
          },
          "Anthropic raw usage (before billing adjustment)",
        );

        event.usage = applyBillingAnthropic(event.usage);

        logger.info(
          {
            input_tokens: event.usage.input_tokens ?? 0,
            cache_creation_input_tokens: event.usage.cache_creation_input_tokens ?? 0,
            cache_read_input_tokens: event.usage.cache_read_input_tokens ?? 0,
            event: "message_delta",
          },
          "Anthropic adjusted usage (after billing, sent to client)",
        );
      }

      await writeToSink(
        sink,
        `data: ${JSON.stringify(normalizeAnthropicStreamEvent(transformEvent(event)))}\n`,
      );
      return;
    } catch {
      // Ignore malformed SSE data and forward it as-is.
    }

    await writeToSink(sink, `${line}\n`);
  };

  const pushChunk = async (chunk: Uint8Array): Promise<void> => {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      await writeLine(line);
    }
  };

  const keepalive = startKeepAlive(
    options?.keepaliveIntervalMs,
    () => {
      void writeToSink(sink, options?.keepaliveChunk ?? ": ping\n\n");
    },
  );

  try {
    let initialRead: StreamReadResult | undefined;

    if (options?.firstReadPromise) {
      initialRead = await options.firstReadPromise;
    }

    if (options?.firstChunk) {
      await pushChunk(options.firstChunk);
    } else if (initialRead && !initialRead.done && initialRead.value) {
      await pushChunk(initialRead.value);
    }

    const streamDone = options?.streamDone ?? initialRead?.done ?? false;
    if (!streamDone) {
      for (;;) {
        if (isClosed(sink)) {
          reader.cancel().catch(() => {});
          break;
        }

        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        await pushChunk(value);
      }
    }

    if (buffer) {
      await writeToSink(sink, buffer);
    }

    await endSink(sink);
  } finally {
    if (keepalive) {
      clearInterval(keepalive);
    }
    reader.releaseLock?.();
  }
}

export async function pipeAnthropicStreamWithUsageAdjust(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  res: Response,
  options?: StreamPipeOptions & {
    keepaliveIntervalMs?: number;
    structuredOutputShim?: AnthropicStructuredOutputShim;
  },
): Promise<void> {
  await pipeAnthropicStreamWithUsageAdjustToSink(reader, toResponseSink(res), {
    ...options,
    keepaliveChunk: ": ping\n\n",
  });
}

export async function readUpstreamArrayBufferWithKeepAlive(
  upstream: globalThis.Response,
  res: Response,
  options?: {
    keepaliveIntervalMs?: number;
  },
): Promise<ArrayBuffer> {
  if (!options?.keepaliveIntervalMs || options.keepaliveIntervalMs <= 0) {
    return await upstream.arrayBuffer();
  }

  writeWhitespaceKeepAlive(res);
  const keepalive = startKeepAlive(
    options.keepaliveIntervalMs,
    () => writeWhitespaceKeepAlive(res),
  );

  try {
    return await upstream.arrayBuffer();
  } finally {
    if (keepalive) {
      clearInterval(keepalive);
    }
  }
}

export { writeKeepAlive };
