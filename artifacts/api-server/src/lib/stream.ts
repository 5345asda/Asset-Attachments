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
  firstReadPromise?: Promise<StreamReadResult>;
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

    if (initialRead && !initialRead.done && initialRead.value) {
      await writeToSink(sink, initialRead.value);
    }

    const streamDone = initialRead?.done ?? false;
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
        event.message.usage = applyBillingAnthropic(event.message.usage);
      } else if (
        event.type === "message_delta"
        && event.usage
        && (
          event.usage.cache_read_input_tokens
          || event.usage.input_tokens
          || event.usage.cache_creation_input_tokens
        )
      ) {
        event.usage = applyBillingAnthropic(event.usage);
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

    if (initialRead && !initialRead.done && initialRead.value) {
      await pushChunk(initialRead.value);
    }

    const streamDone = initialRead?.done ?? false;
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
