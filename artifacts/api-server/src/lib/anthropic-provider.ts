const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";

export type AnthropicProviderConfig = {
  configured: boolean;
  baseUrl: string;
  apiKey: string;
  source: "replit_integration" | "direct_secret" | "none";
};

function readEnv(name: string): string {
  return process.env[name]?.trim() || "";
}

export function getAnthropicProviderConfig(): AnthropicProviderConfig {
  const integrationBaseUrl = readEnv("AI_INTEGRATIONS_ANTHROPIC_BASE_URL");
  const integrationApiKey = readEnv("AI_INTEGRATIONS_ANTHROPIC_API_KEY");

  if (integrationBaseUrl && integrationApiKey) {
    return {
      configured: true,
      baseUrl: integrationBaseUrl,
      apiKey: integrationApiKey,
      source: "replit_integration",
    };
  }

  const directApiKey = readEnv("ANTHROPIC_API_KEY");
  if (directApiKey) {
    return {
      configured: true,
      baseUrl: readEnv("ANTHROPIC_BASE_URL") || DEFAULT_ANTHROPIC_BASE_URL,
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
