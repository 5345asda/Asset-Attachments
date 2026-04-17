import type { Response } from "express";
import { applyBillingAnthropic, createCacheUsageNormalizer } from "./billing";
import { logger } from "./logger";

function writeKeepAlive(res: Response): void {
  if (!res.destroyed) {
    res.write(": ping\n\n");
  }
}

export async function pipeReaderToResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  res: Response,
): Promise<void> {
  try {
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

    if (!res.destroyed) {
      res.end();
    }
  } finally {
    reader.releaseLock?.();
  }
}

export async function pipeAnthropicStreamWithUsageAdjust(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  res: Response,
): Promise<void> {
  const dec = new TextDecoder();
  let buf = "";
  const normalizeCacheUsage = createCacheUsageNormalizer();

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
      const event = JSON.parse(raw);

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

        res.write(`data: ${JSON.stringify(event)}\n`);
        return;
      }

      if (
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

        res.write(`data: ${JSON.stringify(event)}\n`);
        return;
      }
    } catch {
      // Ignore malformed SSE data and forward it as-is.
    }

    res.write(line + "\n");
  };

  const keepalive = setInterval(() => writeKeepAlive(res), 15000);

  try {
    for (;;) {
      if (res.destroyed) {
        reader.cancel().catch(() => {});
        break;
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        writeLine(line);
      }
    }

    if (buf && !res.destroyed) {
      res.write(buf);
    }

    if (!res.destroyed) {
      res.end();
    }
  } finally {
    clearInterval(keepalive);
  }
}
