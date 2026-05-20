import type { InternalRunEnvelope, InternalRunMeta } from "./run-types";

export type RedisRunStoreClient = {
  connect?: () => Promise<void>;
  disconnect?: () => Promise<void>;
  ping: () => Promise<string>;
  hSet: (key: string, value: Record<string, string>) => Promise<number>;
  hGetAll: (key: string) => Promise<Record<string, string>>;
  rPush: (key: string, value: string) => Promise<number>;
  publish: (channel: string, message: string) => Promise<number>;
  set: (key: string, value: string) => Promise<string>;
  get: (key: string) => Promise<string | null>;
  del: (...keys: string[]) => Promise<number>;
  expire: (key: string, ttlSeconds: number) => Promise<number>;
  exists: (key: string) => Promise<number>;
  multi?: () => RedisRunStorePipeline;
};

export type RedisRunStorePipeline = {
  hSet: (key: string, value: Record<string, string>) => RedisRunStorePipeline;
  rPush: (key: string, value: string) => RedisRunStorePipeline;
  publish: (channel: string, message: string) => RedisRunStorePipeline;
  set: (key: string, value: string) => RedisRunStorePipeline;
  expire: (key: string, ttlSeconds: number) => RedisRunStorePipeline;
  exec: () => Promise<unknown[]>;
};

type CompletedRunPayload = {
  status: number;
  contentType: string;
  body: Uint8Array;
  completedAt: string;
  eventCount: number;
};

type FailedRunPayload = {
  failedAt: string;
  message: string;
  code?: string;
};

function isTextLikeContentType(contentType: string): boolean {
  return contentType.startsWith("text/")
    || contentType.includes("json")
    || contentType.includes("xml")
    || contentType.includes("javascript");
}

function serializeBody(
  body: Uint8Array,
  contentType: string,
): Record<string, unknown> {
  if (isTextLikeContentType(contentType)) {
    return {
      bodyText: Buffer.from(body).toString("utf8"),
    };
  }

  return {
    bodyBase64: Buffer.from(body).toString("base64"),
  };
}

function parseMeta(hash: Record<string, string>): InternalRunMeta | null {
  if (!hash.runId) {
    return null;
  }

  return {
    runId: hash.runId,
    provider: hash.provider as InternalRunMeta["provider"],
    routePath: hash.routePath,
    method: hash.method,
    headers: hash.requestHeadersJson ? JSON.parse(hash.requestHeadersJson) as Record<string, string> : {},
    body: hash.requestBodyJson ? JSON.parse(hash.requestBodyJson) : undefined,
    stream: hash.stream === "true",
    createdAt: hash.createdAt,
    status: hash.status as InternalRunMeta["status"],
    updatedAt: hash.updatedAt,
    startedAt: hash.startedAt || undefined,
    completedAt: hash.completedAt || undefined,
    cancelRequestedAt: hash.cancelRequestedAt || undefined,
    cancelReason: hash.cancelReason || undefined,
    errorCode: hash.errorCode || undefined,
    errorMessage: hash.errorMessage || undefined,
  };
}

class RedisRunStore {
  constructor(
    private readonly client: RedisRunStoreClient,
    private readonly keyPrefix: string,
    private readonly resultTtlSeconds: number,
  ) {}

  private metaKey(runId: string): string {
    return `${this.keyPrefix}:run:${runId}:meta`;
  }

  private eventsKey(runId: string): string {
    return `${this.keyPrefix}:run:${runId}:events`;
  }

  private finalKey(runId: string): string {
    return `${this.keyPrefix}:run:${runId}:final`;
  }

  private errorKey(runId: string): string {
    return `${this.keyPrefix}:run:${runId}:error`;
  }

  private cancelKey(runId: string): string {
    return `${this.keyPrefix}:run:${runId}:cancel`;
  }

  private notifyChannel(runId: string): string {
    return `${this.keyPrefix}:run:${runId}:notify`;
  }

  private async notifyRunUpdate(runId: string, kind: string): Promise<void> {
    await this.client.publish(this.notifyChannel(runId), kind).catch(() => {});
  }

  private createPipeline(): RedisRunStorePipeline {
    if (typeof this.client.multi === "function") {
      return this.client.multi();
    }

    const steps: Array<() => Promise<unknown>> = [];
    const client = this.client;
    const pipeline: RedisRunStorePipeline = {
      hSet(key, value) {
        steps.push(async () => await client.hSet(key, value));
        return pipeline;
      },
      rPush(key, value) {
        steps.push(async () => await client.rPush(key, value));
        return pipeline;
      },
      publish(channel, message) {
        steps.push(async () => await client.publish(channel, message));
        return pipeline;
      },
      set(key, value) {
        steps.push(async () => await client.set(key, value));
        return pipeline;
      },
      expire(key, ttlSeconds) {
        steps.push(async () => await client.expire(key, ttlSeconds));
        return pipeline;
      },
      async exec() {
        const results = [];
        for (const step of steps) {
          results.push(await step());
        }
        return results;
      },
    };

    return pipeline;
  }

  private async writeMeta(
    runId: string,
    fields: Record<string, string>,
  ): Promise<void> {
    await this.client.hSet(this.metaKey(runId), fields);
    await this.client.expire(this.metaKey(runId), this.resultTtlSeconds);
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  async acceptRun(envelope: InternalRunEnvelope): Promise<void> {
    await this.writeMeta(envelope.runId, {
      runId: envelope.runId,
      provider: envelope.provider,
      routePath: envelope.routePath,
      method: envelope.method,
      requestHeadersJson: JSON.stringify(envelope.headers),
      requestBodyJson: envelope.body === undefined ? "" : JSON.stringify(envelope.body),
      stream: envelope.stream ? "true" : "false",
      createdAt: envelope.createdAt,
      status: "accepted",
      updatedAt: envelope.createdAt,
    });
  }

  async getRunMeta(runId: string): Promise<InternalRunMeta | null> {
    return parseMeta(await this.client.hGetAll(this.metaKey(runId)));
  }

  async markRunning(runId: string, startedAt: string): Promise<void> {
    await this.writeMeta(runId, {
      status: "running",
      startedAt,
      updatedAt: startedAt,
    });
  }

  async markStreaming(runId: string, updatedAt: string): Promise<void> {
    await this.writeMeta(runId, {
      status: "streaming",
      updatedAt,
    });
  }

  async markStreamingAndAppendEvent(
    runId: string,
    updatedAt: string,
    chunk: Uint8Array | string,
  ): Promise<void> {
    const data = typeof chunk === "string"
      ? chunk
      : Buffer.from(chunk).toString("utf8");

    await this.createPipeline()
      .hSet(this.metaKey(runId), {
        status: "streaming",
        updatedAt,
      })
      .expire(this.metaKey(runId), this.resultTtlSeconds)
      .rPush(this.eventsKey(runId), JSON.stringify({ data }))
      .expire(this.eventsKey(runId), this.resultTtlSeconds)
      .publish(this.notifyChannel(runId), "event")
      .exec();
  }

  async appendEvent(runId: string, chunk: Uint8Array | string): Promise<void> {
    const data = typeof chunk === "string"
      ? chunk
      : Buffer.from(chunk).toString("utf8");

    await this.createPipeline()
      .rPush(this.eventsKey(runId), JSON.stringify({ data }))
      .expire(this.eventsKey(runId), this.resultTtlSeconds)
      .publish(this.notifyChannel(runId), "event")
      .exec();
  }

  async markCompleted(runId: string, payload: CompletedRunPayload): Promise<void> {
    await this.createPipeline()
      .hSet(this.metaKey(runId), {
        status: "completed",
        completedAt: payload.completedAt,
        updatedAt: payload.completedAt,
        errorCode: "",
        errorMessage: "",
      })
      .expire(this.metaKey(runId), this.resultTtlSeconds)
      .set(this.finalKey(runId), JSON.stringify({
        status: payload.status,
        contentType: payload.contentType,
        ...serializeBody(payload.body, payload.contentType),
        eventCount: payload.eventCount,
        completedAt: payload.completedAt,
      }))
      .expire(this.finalKey(runId), this.resultTtlSeconds)
      .expire(this.eventsKey(runId), this.resultTtlSeconds)
      .publish(this.notifyChannel(runId), "completed")
      .exec();
  }

  async markFailed(runId: string, payload: FailedRunPayload): Promise<void> {
    await this.createPipeline()
      .hSet(this.metaKey(runId), {
        status: "failed",
        completedAt: payload.failedAt,
        updatedAt: payload.failedAt,
        errorCode: payload.code ?? "",
        errorMessage: payload.message,
      })
      .expire(this.metaKey(runId), this.resultTtlSeconds)
      .set(this.errorKey(runId), JSON.stringify(payload))
      .expire(this.errorKey(runId), this.resultTtlSeconds)
      .expire(this.eventsKey(runId), this.resultTtlSeconds)
      .publish(this.notifyChannel(runId), "failed")
      .exec();
  }

  async requestCancel(runId: string, reason?: string): Promise<boolean> {
    if (!await this.getRunMeta(runId)) {
      return false;
    }

    const cancelRequestedAt = new Date().toISOString();
    await this.client.set(this.cancelKey(runId), JSON.stringify({
      reason: reason?.trim() || undefined,
      cancelRequestedAt,
    }));
    await this.createPipeline()
      .expire(this.cancelKey(runId), this.resultTtlSeconds)
      .hSet(this.metaKey(runId), {
        status: "cancel_requested",
        cancelRequestedAt,
        cancelReason: reason?.trim() || "",
        updatedAt: cancelRequestedAt,
      })
      .expire(this.metaKey(runId), this.resultTtlSeconds)
      .publish(this.notifyChannel(runId), "cancel_requested")
      .exec();
    return true;
  }

  async isCancelRequested(runId: string): Promise<boolean> {
    return await this.client.exists(this.cancelKey(runId)) > 0;
  }

  async markCancelled(runId: string, cancelledAt: string, reason?: string): Promise<void> {
    await this.createPipeline()
      .hSet(this.metaKey(runId), {
        status: "cancelled",
        completedAt: cancelledAt,
        updatedAt: cancelledAt,
        cancelReason: reason?.trim() || "",
      })
      .expire(this.metaKey(runId), this.resultTtlSeconds)
      .expire(this.cancelKey(runId), this.resultTtlSeconds)
      .expire(this.eventsKey(runId), this.resultTtlSeconds)
      .publish(this.notifyChannel(runId), "cancelled")
      .exec();
  }
}

export function createRedisRunStore(params: {
  client: RedisRunStoreClient;
  keyPrefix: string;
  resultTtlSeconds: number;
}): RedisRunStore {
  const keyPrefix = params.keyPrefix.trim() || "aa";
  return new RedisRunStore(params.client, keyPrefix, params.resultTtlSeconds);
}
