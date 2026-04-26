import { randomUUID } from "node:crypto";

type JsonObject = Record<string, unknown>;

const ANTHROPIC_MESSAGE_ID_PATTERN = /^msg_[A-Za-z0-9]+$/;

function isRecord(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function buildOpaqueAnthropicMessageId(source: string): string {
  if (ANTHROPIC_MESSAGE_ID_PATTERN.test(source)) {
    return source;
  }

  const withoutPrefix = source.startsWith("msg_") ? source.slice(4) : source;
  const parts = withoutPrefix.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const candidate = [...parts].reverse().find((part) => part.length >= 8) ?? parts.at(-1);

  if (candidate) {
    return `msg_${candidate}`;
  }

  return `msg_${randomUUID().replace(/-/g, "")}`;
}

export function normalizeAnthropicMessageId(id: unknown): string | undefined {
  if (typeof id !== "string") {
    return undefined;
  }

  const trimmed = id.trim();
  if (!trimmed) {
    return undefined;
  }

  return buildOpaqueAnthropicMessageId(trimmed);
}

export function normalizeAnthropicResponseMessage<T extends JsonObject>(payload: T): T {
  if (payload.type !== "message") {
    return payload;
  }

  const normalizedId = normalizeAnthropicMessageId(payload.id);
  if (!normalizedId || normalizedId === payload.id) {
    return payload;
  }

  return {
    ...payload,
    id: normalizedId,
  };
}

export function normalizeAnthropicStreamEvent<T extends JsonObject>(event: T): T {
  if (event.type !== "message_start" || !isRecord(event.message)) {
    return event;
  }

  const normalizedId = normalizeAnthropicMessageId(event.message.id);
  if (!normalizedId || normalizedId === event.message.id) {
    return event;
  }

  return {
    ...event,
    message: {
      ...event.message,
      id: normalizedId,
    },
  };
}
