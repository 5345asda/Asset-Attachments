export type RedisConfig = {
  configured: boolean;
  url: string;
  apiKey: string;
  source: "direct_secret" | "upstash_secret" | "none";
};

function readEnv(name: string): string {
  return process.env[name]?.trim() || "";
}

export function getRedisConfig(): RedisConfig {
  const directUrl = readEnv("REDIS_URL");
  const directApiKey = readEnv("REDIS_KEY") || readEnv("REDIS_TOKEN");

  if (directUrl && directApiKey) {
    return {
      configured: true,
      url: directUrl,
      apiKey: directApiKey,
      source: "direct_secret",
    };
  }

  const upstashUrl = readEnv("UPSTASH_REDIS_REST_URL");
  const upstashApiKey = readEnv("UPSTASH_REDIS_REST_TOKEN");

  if (upstashUrl && upstashApiKey) {
    return {
      configured: true,
      url: upstashUrl,
      apiKey: upstashApiKey,
      source: "upstash_secret",
    };
  }

  return {
    configured: false,
    url: "",
    apiKey: "",
    source: "none",
  };
}
