export type ProxyApiKeyConfig = {
  configured: boolean;
  value: string;
  source: "env" | "none";
};

function readEnv(name: string): string {
  return process.env[name]?.trim() || "";
}

export function getProxyApiKeyConfig(): ProxyApiKeyConfig {
  const value = readEnv("PROXY_API_KEY");

  if (!value) {
    return {
      configured: false,
      value: "",
      source: "none",
    };
  }

  return {
    configured: true,
    value,
    source: "env",
  };
}

export function getProxyApiKey(): string {
  return getProxyApiKeyConfig().value;
}
