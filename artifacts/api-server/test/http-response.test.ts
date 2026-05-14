import assert from "node:assert/strict";
import test from "node:test";

import { sendExecutionResult } from "../src/lib/providers/http.ts";

test("sendExecutionResult flushes headers before piping the body", async () => {
  const events: string[] = [];

  const response = {
    destroyed: false,
    status(code: number) {
      events.push(`status:${code}`);
      return this;
    },
    setHeader(name: string, value: string) {
      events.push(`header:${name}=${value}`);
      return this;
    },
    write(chunk: string | Uint8Array) {
      events.push(
        `write:${typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")}`,
      );
      return true;
    },
    end() {
      events.push("end");
      this.destroyed = true;
      return this;
    },
    flushHeaders() {
      events.push("flush");
    },
  };

  await sendExecutionResult(
    response as any,
    {
      status: 200,
      contentType: "application/json",
      stream: false,
      readBody: async () => Buffer.from("{}"),
      pipeToSink: async (sink) => {
        events.push("pipe");
        await sink.write("{}");
        await sink.end();
      },
    },
    {
      streamKeepaliveIntervalMs: 15000,
      nonStreamKeepaliveIntervalMs: 15000,
      streamBootstrapRetries: 0,
    },
  );

  assert.ok(events.includes("flush"));
  assert.ok(events.indexOf("flush") < events.indexOf("pipe"));
});
