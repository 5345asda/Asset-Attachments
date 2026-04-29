const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

export type OpenAIProviderConfig = {
  configured: boolean;
  baseUrl: string;
  apiKey: string;
  source: "replit_integration" | "direct_secret" | "none";
};

function readEnv(name: string): string {
  return process.env[name]?.trim() || "";
}

export function getOpenAIProviderConfig(): OpenAIProviderConfig {
  const integrationBaseUrl = readEnv("AI_INTEGRATIONS_OPENAI_BASE_URL");
  const integrationApiKey = readEnv("AI_INTEGRATIONS_OPENAI_API_KEY");

  if (integrationBaseUrl && integrationApiKey) {
    return {
      configured: true,
      baseUrl: integrationBaseUrl,
      apiKey: integrationApiKey,
      source: "replit_integration",
    };
  }

  const directApiKey = readEnv("OPENAI_API_KEY");
  if (directApiKey) {
    return {
      configured: true,
      baseUrl: readEnv("OPENAI_BASE_URL") || DEFAULT_OPENAI_BASE_URL,
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
