const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export type OpenRouterProviderConfig = {
  configured: boolean;
  baseUrl: string;
  apiKey: string;
  source: "replit_integration" | "direct_secret" | "none";
};

function readEnv(name: string): string {
  return process.env[name]?.trim() || "";
}

export function getOpenRouterProviderConfig(): OpenRouterProviderConfig {
  const integrationBaseUrl = readEnv("AI_INTEGRATIONS_OPENROUTER_BASE_URL");
  const integrationApiKey = readEnv("AI_INTEGRATIONS_OPENROUTER_API_KEY");

  if (integrationBaseUrl && integrationApiKey) {
    return {
      configured: true,
      baseUrl: integrationBaseUrl,
      apiKey: integrationApiKey,
      source: "replit_integration",
    };
  }

  const directApiKey = readEnv("OPENROUTER_API_KEY");
  if (directApiKey) {
    return {
      configured: true,
      baseUrl: readEnv("OPENROUTER_BASE_URL") || DEFAULT_OPENROUTER_BASE_URL,
      apiKey: directApiKey,
      source: "direct_secret",
    };
  }

  return {
    configured: false,
    baseUrl: "",
    apiKey: "",
    source: "none",
  };
}
