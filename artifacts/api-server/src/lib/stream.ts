import type { Response } from "express";
import { applyBillingAnthropic, createCacheUsageNormalizer } from "./billing";
import { normalizeAnthropicStreamEvent } from "./anthropic-message-id";
import {
  createAnthropicStructuredOutputEventTransformer,
  type AnthropicStructuredOutputShim,
} from "./anthropic-structured-output";
import { logger } from "./logger";

type StreamReadResult = Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>;

type StreamPipeOptions = {
  keepaliveIntervalMs?: number;
  firstChunk?: Uint8Array;
  firstReadPromise?: Promise<StreamReadResult>;
  streamDone?: boolean;
};

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

export async function pipeReaderToResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  res: Response,
  options?: StreamPipeOptions,
): Promise<void> {
  const keepalive = startKeepAlive(options?.keepaliveIntervalMs, () => writeKeepAlive(res));

  try {
    let initialRead: StreamReadResult | undefined;

    if (options?.firstReadPromise) {
      initialRead = await options.firstReadPromise;
    }

    if (options?.firstChunk && !res.destroyed) {
      res.write(options.firstChunk);
    } else if (initialRead && !initialRead.done && initialRead.value && !res.destroyed) {
      res.write(initialRead.value);
    }

    const streamDone = options?.streamDone ?? initialRead?.done ?? false;
    if (!streamDone) {
      for (;;) {
        if (res.destroyed) {
          reader.cancel().catch(() => {});
          break;
        }

        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        res.write(value);
      }
    }

    if (!res.destroyed) {
      res.end();
    }
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
    structuredOutputShim?: AnthropicStructuredOutputShim;
  },
): Promise<void> {
  const dec = new TextDecoder();
  let buf = "";
  const normalizeCacheUsage = createCacheUsageNormalizer();
  const transformEvent = createAnthropicStructuredOutputEventTransformer(options?.structuredOutputShim);

  const writeLine = (line: string) => {
    if (!line.startsWith("data: ")) {
      res.write(line + "\n");
      return;
    }

    const raw = line.slice(6).trim();
    if (!raw || raw === "[DONE]") {
      res.write(line + "\n");
      return;
    }

    try {
      const event: any = JSON.parse(raw);

      if (event.type === "message_start" && event.message?.usage) {
        const rawUsage = event.message.usage;
        const normalizedCache = normalizeCacheUsage(rawUsage);
        logger.info(
          {
            input_tokens: rawUsage.input_tokens,
            cache_creation_input_tokens: rawUsage.cache_creation_input_tokens ?? 0,
            cache_read_input_tokens: rawUsage.cache_read_input_tokens ?? 0,
            event: "message_start",
          },
          "Anthropic raw usage (before billing adjustment)",
        );

        const adjustedUsage = applyBillingAnthropic({
          ...rawUsage,
          cache_creation_input_tokens: normalizedCache.cacheCreation,
          cache_read_input_tokens: normalizedCache.cacheRead,
        }, { cacheAlreadyNormalized: true });
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
      }
      else if (
        event.type === "message_delta" &&
        event.usage &&
        (event.usage.cache_read_input_tokens ||
          event.usage.input_tokens ||
          event.usage.cache_creation_input_tokens)
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

        const normalizedCache = normalizeCacheUsage(event.usage);
        event.usage = applyBillingAnthropic({
          ...event.usage,
          cache_creation_input_tokens: normalizedCache.cacheCreation,
          cache_read_input_tokens: normalizedCache.cacheRead,
        }, { cacheAlreadyNormalized: true });

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

      res.write(`data: ${JSON.stringify(normalizeAnthropicStreamEvent(transformEvent(event)))}\n`);
      return;
    } catch {
      // Ignore malformed SSE data and forward it as-is.
    }

    res.write(line + "\n");
  };

  const pushChunk = (chunk: Uint8Array) => {
    buf += dec.decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      writeLine(line);
    }
  };

  const keepalive = startKeepAlive(
    options?.keepaliveIntervalMs ?? 15000,
    () => writeKeepAlive(res),
  );

  try {
    let initialRead: StreamReadResult | undefined;

    if (options?.firstReadPromise) {
      initialRead = await options.firstReadPromise;
    }

    if (options?.firstChunk) {
      pushChunk(options.firstChunk);
    } else if (initialRead && !initialRead.done && initialRead.value) {
      pushChunk(initialRead.value);
    }

    const streamDone = options?.streamDone ?? initialRead?.done ?? false;
    if (!streamDone) {
      for (;;) {
        if (res.destroyed) {
          reader.cancel().catch(() => {});
          break;
        }

        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        pushChunk(value);
      }
    }

    if (buf && !res.destroyed) {
      res.write(buf);
    }

    if (!res.destroyed) {
      res.end();
    }
  } finally {
    if (keepalive) {
      clearInterval(keepalive);
    }
    reader.releaseLock?.();
  }
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
