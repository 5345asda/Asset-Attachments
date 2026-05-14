import type { InternalRunEnvelope } from "./run-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === "string");
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseInternalRunEnvelope(value: unknown): InternalRunEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }

  const runId = readString(value.runId);
  const provider = readString(value.provider);
  const routePath = readString(value.routePath);
  const method = readString(value.method).toUpperCase();
  const createdAt = readString(value.createdAt);
  const { headers, body, stream } = value;

  if (!runId || !provider || !routePath || !method || !createdAt) {
    return null;
  }

  if (!routePath.startsWith("/")) {
    return null;
  }

  if (!isStringRecord(headers) || typeof stream !== "boolean") {
    return null;
  }

  if (Number.isNaN(Date.parse(createdAt))) {
    return null;
  }

  return {
    runId,
    provider,
    routePath,
    method,
    headers,
    body,
    stream,
    createdAt,
  };
}
