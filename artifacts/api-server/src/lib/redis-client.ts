import { Buffer } from "node:buffer";
import { createClient } from "redis";
import { getInternalRunsConfig } from "./internal-run-config";
import { logger } from "./logger";
import type { RedisRunStoreClient } from "./redis-run-store";

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
        },
      });

      client.on("error", (error) => {
        logger.warn(
          {
            error: error instanceof Error ? error.message : String(error),
          },
          "Redis client error",
        );
      });

      await client.connect();

      const storeClient: RedisRunStoreClient = {
        connect: async () => {
          await client.connect();
        },
        disconnect: async () => {
          await client.disconnect();
        },
        ping: async () => await client.ping(),
        hSet: async (key, value) => await client.hSet(key, value),
        hGetAll: async (key) => await client.hGetAll(key),
        rPush: async (key, value) => await client.rPush(key, value),
        set: async (key, value) => (await client.set(key, value)) ?? "OK",
        get: async (key) => await client.get(key),
        del: async (...keys) => await client.del(keys),
        expire: async (key, ttlSeconds) => Number(await client.expire(key, ttlSeconds)),
        exists: async (key) => await client.exists(key),
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
