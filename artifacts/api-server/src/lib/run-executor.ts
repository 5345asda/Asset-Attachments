import { ApiError } from "./api-error";
import { createRedisRunStore } from "./redis-run-store";
import { createRunRegistry } from "./run-registry";
import type { InternalRunEnvelope } from "./run-types";
import type { ProviderExecutionLogger, ProviderExecutionResult } from "./providers/types";

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function createRunExecutor(params: {
  store: ReturnType<typeof createRedisRunStore>;
  registry: ReturnType<typeof createRunRegistry>;
  logger: ProviderExecutionLogger;
  cancelPollMs: number;
  now?: () => string;
  executeProvider: (params: {
    envelope: InternalRunEnvelope;
    abortSignal: AbortSignal;
  }) => Promise<ProviderExecutionResult>;
}) {
  const now = params.now ?? (() => new Date().toISOString());

  return {
    async start(envelope: InternalRunEnvelope): Promise<void> {
      const abortController = new AbortController();
      params.registry.start(envelope.runId, abortController);

      const cancelPoll = setInterval(() => {
        void params.store.isCancelRequested(envelope.runId).then((cancelRequested) => {
          if (cancelRequested && !abortController.signal.aborted) {
            params.registry.requestCancel(envelope.runId);
          }
        }).catch(() => {});
      }, params.cancelPollMs);
      cancelPoll.unref?.();

      try {
        await params.store.markRunning(envelope.runId, now());

        if (await params.store.isCancelRequested(envelope.runId)) {
          abortController.abort("cancel_requested");
        }

        const result = await params.executeProvider({
          envelope,
          abortSignal: abortController.signal,
        });

        if (result.stream) {
          let eventCount = 0;
          let streamingMarked = false;

          await result.pipeToSink({
            write: async (chunk) => {
              if (!streamingMarked) {
                streamingMarked = true;
                await params.store.markStreaming(envelope.runId, now());
              }

              eventCount += 1;
              await params.store.appendEvent(envelope.runId, chunk);
            },
            end: async () => {},
            isClosed: () => abortController.signal.aborted,
          });

          await params.store.markCompleted(envelope.runId, {
            status: result.status,
            contentType: result.contentType,
            body: Buffer.alloc(0),
            completedAt: now(),
            eventCount,
          });
          return;
        }

        const body = await result.readBody();
        await params.store.markCompleted(envelope.runId, {
          status: result.status,
          contentType: result.contentType,
          body,
          completedAt: now(),
          eventCount: 0,
        });
      } catch (error) {
        if (
          abortController.signal.aborted
          || isAbortError(error)
          || await params.store.isCancelRequested(envelope.runId)
        ) {
          const meta = await params.store.getRunMeta(envelope.runId);
          await params.store.markCancelled(
            envelope.runId,
            now(),
            meta?.cancelReason,
          );
          return;
        }

        const failedAt = now();
        if (error instanceof ApiError) {
          await params.store.markFailed(envelope.runId, {
            failedAt,
            message: error.message,
            code: error.code,
          });
        } else {
          await params.store.markFailed(envelope.runId, {
            failedAt,
            message: error instanceof Error ? error.message : "Internal run execution failed",
          });
        }

        params.logger.error(
          {
            runId: envelope.runId,
            err: error instanceof Error ? error : undefined,
          },
          "Internal run execution failed",
        );
      } finally {
        clearInterval(cancelPoll);
        params.registry.finish(envelope.runId);
      }
    },
  };
}
