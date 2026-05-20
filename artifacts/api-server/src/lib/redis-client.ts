import { Buffer } from "node:buffer";
import { createClient } from "redis";
import { getInternalRunsConfig } from "./internal-run-config";
import { logger } from "./logger";
import type { RedisRunStoreClient, RedisRunStorePipeline } from "./redis-run-store";

let redisClientPromise: Promise<RedisRunStoreClient> | null = null;

export async function getRedisRunStoreClient(): Promise<RedisRunStoreClient> {
  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      const config = getInternalRunsConfig();
      const tlsCaPem = config.redis.tlsCaPemB64
        ? Buffer.from(config.redis.tlsCaPemB64, "base64").toString("utf8")
        : "";

      const client = createClient({
        url: config.redis.url,
        username: config.redis.username || undefined,
        password: config.redis.password || undefined,
        socket: {
          connectTimeout: config.redis.connectTimeoutMs,
          tls: config.redis.url.startsWith("rediss://") || Boolean(tlsCaPem),
          ca: tlsCaPem ? [tlsCaPem] : undefined,
          reconnectStrategy: false,
        },
      });
      let connectPromise: Promise<void> | null = null;

      client.on("error", (error) => {
        logger.warn(
          {
            error: error instanceof Error ? error.message : String(error),
          },
          "Redis client error",
        );
      });

      async function ensureReady(): Promise<void> {
        if (client.isReady) {
          return;
        }

        if (!connectPromise) {
          connectPromise = client.connect()
            .then(() => undefined)
            .finally(() => {
              connectPromise = null;
            });
        }

        await connectPromise;
      }

      async function run<T>(operation: () => Promise<T>): Promise<T> {
        await ensureReady();
        return await operation();
      }

      await ensureReady();

      const storeClient: RedisRunStoreClient = {
        connect: async () => await ensureReady(),
        disconnect: async () => {
          if (connectPromise) {
            try {
              await connectPromise;
            } catch {
              // Ignore a failed in-flight connect; caller asked to disconnect.
            }
          }

          if (client.isOpen) {
            await client.disconnect();
          }
        },
        ping: async () => await run(async () => await client.ping()),
        hSet: async (key, value) => await run(async () => await client.hSet(key, value)),
        hGetAll: async (key) => await run(async () => await client.hGetAll(key)),
        rPush: async (key, value) => await run(async () => await client.rPush(key, value)),
        publish: async (channel, message) => await run(async () => await client.publish(channel, message)),
        set: async (key, value) => await run(async () => (await client.set(key, value)) ?? "OK"),
        get: async (key) => await run(async () => await client.get(key)),
        del: async (...keys) => await run(async () => await client.del(keys)),
        expire: async (key, ttlSeconds) => await run(async () => Number(await client.expire(key, ttlSeconds))),
        exists: async (key) => await run(async () => await client.exists(key)),
        multi: () => {
          const tx = client.multi() as any;
          const pipeline: RedisRunStorePipeline = {
            hSet(key, value) {
              tx.hSet(key, value);
              return pipeline;
            },
            rPush(key, value) {
              tx.rPush(key, value);
              return pipeline;
            },
            publish(channel, message) {
              tx.publish(channel, message);
              return pipeline;
            },
            set(key, value) {
              tx.set(key, value);
              return pipeline;
            },
            expire(key, ttlSeconds) {
              tx.expire(key, ttlSeconds);
              return pipeline;
            },
            async exec() {
              await ensureReady();
              return await tx.exec();
            },
          };
          return pipeline;
        },
      };

      return storeClient;
    })();
  }

  const client = await redisClientPromise;
  if (!client) {
    throw new Error("Redis client is unavailable");
  }

  return client;
}
