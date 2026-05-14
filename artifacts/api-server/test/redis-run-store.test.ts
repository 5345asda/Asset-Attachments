import test from "node:test";
import assert from "node:assert/strict";

import type { InternalRunEnvelope } from "../src/lib/run-types.ts";
import { createRedisRunStore } from "../src/lib/redis-run-store.ts";
import { FakeRedisClient } from "./fake-redis.ts";

function makeEnvelope(runId: string): InternalRunEnvelope {
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
      messages: [],
    },
    stream: false,
    createdAt: "2026-05-14T00:00:00.000Z",
  };
}

test("createRedisRunStore persists lifecycle data and terminal payloads", async () => {
  const redis = new FakeRedisClient();
  const store = createRedisRunStore({
    client: redis,
    keyPrefix: "aa",
    resultTtlSeconds: 60,
  });

  const envelope = makeEnvelope("run-complete");

  await store.acceptRun(envelope);
  await store.markRunning(envelope.runId, "2026-05-14T00:00:01.000Z");
  await store.appendEvent(envelope.runId, "data: one\n\n");
  await store.markCompleted(envelope.runId, {
    status: 200,
    contentType: "application/json",
    body: Buffer.from("{\"ok\":true}", "utf8"),
    completedAt: "2026-05-14T00:00:02.000Z",
    eventCount: 1,
  });

  const meta = await store.getRunMeta(envelope.runId);
  assert.equal(meta?.status, "completed");
  assert.equal(meta?.startedAt, "2026-05-14T00:00:01.000Z");
  assert.equal(meta?.completedAt, "2026-05-14T00:00:02.000Z");

  const finalPayload = JSON.parse(redis.strings.get("aa:run:run-complete:final") ?? "{}") as Record<string, unknown>;
  assert.deepEqual(finalPayload, {
    status: 200,
    contentType: "application/json",
    bodyText: "{\"ok\":true}",
    eventCount: 1,
    completedAt: "2026-05-14T00:00:02.000Z",
  });

  const events = (redis.lists.get("aa:run:run-complete:events") ?? []).map((entry) => JSON.parse(entry) as Record<string, unknown>);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.data, "data: one\n\n");

  assert.equal(redis.expiries.get("aa:run:run-complete:meta"), 60);
  assert.equal(redis.expiries.get("aa:run:run-complete:events"), 60);
  assert.equal(redis.expiries.get("aa:run:run-complete:final"), 60);
});

test("createRedisRunStore records cancel requests and exposes cancel state", async () => {
  const redis = new FakeRedisClient();
  const store = createRedisRunStore({
    client: redis,
    keyPrefix: "aa",
    resultTtlSeconds: 90,
  });

  const envelope = makeEnvelope("run-cancel");
  await store.acceptRun(envelope);

  assert.equal(await store.isCancelRequested(envelope.runId), false);

  const found = await store.requestCancel(envelope.runId, "user requested");
  assert.equal(found, true);
  assert.equal(await store.isCancelRequested(envelope.runId), true);

  const meta = await store.getRunMeta(envelope.runId);
  assert.equal(meta?.status, "cancel_requested");
  assert.equal(meta?.cancelReason, "user requested");

  const cancelPayload = JSON.parse(redis.strings.get("aa:run:run-cancel:cancel") ?? "{}") as Record<string, unknown>;
  assert.equal(cancelPayload.reason, "user requested");
  assert.equal(redis.expiries.get("aa:run:run-cancel:cancel"), 90);
});
