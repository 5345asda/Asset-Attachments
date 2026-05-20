import test from "node:test";
import assert from "node:assert/strict";

import { createRunExecutor } from "../src/lib/run-executor.ts";
import { createRedisRunStore } from "../src/lib/redis-run-store.ts";
import { createRunRegistry } from "../src/lib/run-registry.ts";
import type { InternalRunEnvelope } from "../src/lib/run-types.ts";
import { FakeRedisClient } from "./fake-redis.ts";
import { createSilentLogger, delay } from "./helpers.ts";

function makeEnvelope(runId: string, stream = true): InternalRunEnvelope {
  return {
    runId,
    provider: "openai",
    routePath: "/v1/chat/completions",
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: {
      model: "gpt-5",
      stream,
      messages: [],
    },
    stream,
    createdAt: "2026-05-14T00:00:00.000Z",
  };
}

test("run executor stores streamed wire chunks and completes the run", async () => {
  const redis = new FakeRedisClient();
  const store = createRedisRunStore({
    client: redis,
    keyPrefix: "aa",
    resultTtlSeconds: 120,
  });
  const registry = createRunRegistry();
  const executor = createRunExecutor({
    store,
    registry,
    logger: createSilentLogger(),
    cancelPollMs: 5,
    now: () => "2026-05-14T00:00:01.000Z",
    executeProvider: async () => ({
      status: 200,
      contentType: "text/event-stream",
      stream: true,
      pipeToSink: async (sink) => {
        await sink.write("data: one\n\n");
        await sink.write("data: two\n\n");
        await sink.end();
      },
    }),
  });

  const envelope = makeEnvelope("run-stream");
  await store.acceptRun(envelope);
  redis.commandLog.length = 0;
  await executor.start(envelope);

  const meta = await store.getRunMeta(envelope.runId);
  assert.equal(meta?.status, "completed");
  assert.equal(meta?.startedAt, "2026-05-14T00:00:01.000Z");
  assert.equal(meta?.completedAt, "2026-05-14T00:00:01.000Z");
  assert.equal(registry.activeRunCount(), 0);

  const events = (redis.lists.get("aa:run:run-stream:events") ?? []).map((entry) => JSON.parse(entry) as Record<string, unknown>);
  assert.equal(events.length, 2);
  assert.equal(events[0]?.data, "data: one\n\n");
  assert.equal(events[1]?.data, "data: two\n\n");

  const finalPayload = JSON.parse(redis.strings.get("aa:run:run-stream:final") ?? "{}") as Record<string, unknown>;
  assert.equal(finalPayload.status, 200);
  assert.equal(finalPayload.contentType, "text/event-stream");
  assert.equal(finalPayload.eventCount, 2);
  assert.ok(redis.commandLog.filter((command) => command === "exists").length <= 1);
  assert.equal(
    redis.pipelineExecs.some((commands) => JSON.stringify(commands) === JSON.stringify([
      "hSet",
      "expire",
      "rPush",
      "expire",
      "publish",
    ])),
    true,
  );
});

test("run executor aborts and marks cancelled when Redis cancel marker appears", async () => {
  const redis = new FakeRedisClient();
  const store = createRedisRunStore({
    client: redis,
    keyPrefix: "aa",
    resultTtlSeconds: 120,
  });
  const registry = createRunRegistry();
  let aborted = false;

  const executor = createRunExecutor({
    store,
    registry,
    logger: createSilentLogger(),
    cancelPollMs: 5,
    now: () => "2026-05-14T00:00:05.000Z",
    executeProvider: async ({ abortSignal }) => ({
      status: 200,
      contentType: "text/event-stream",
      stream: true,
      pipeToSink: async () => {
        await new Promise<void>((resolve, reject) => {
          abortSignal.addEventListener("abort", () => {
            aborted = true;
            reject(Object.assign(new Error("Aborted"), {
              name: "AbortError",
            }));
          }, { once: true });
        });
      },
    }),
  });

  const envelope = makeEnvelope("run-cancelled");
  await store.acceptRun(envelope);

  const running = executor.start(envelope);
  await delay(20);
  await store.requestCancel(envelope.runId, "user requested");
  await running;

  assert.equal(aborted, true);
  assert.equal(registry.activeRunCount(), 0);

  const meta = await store.getRunMeta(envelope.runId);
  assert.equal(meta?.status, "cancelled");
  assert.equal(meta?.cancelReason, "user requested");
});
