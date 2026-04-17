const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export type GeminiProviderConfig = {
  configured: boolean;
  baseUrl: string;
  apiKey: string;
  source: "replit_integration" | "direct_secret" | "none";
};

function readEnv(name: string): string {
  return process.env[name]?.trim() || "";
}

export function getGeminiProviderConfig(): GeminiProviderConfig {
  const integrationBaseUrl = readEnv("AI_INTEGRATIONS_GEMINI_BASE_URL");
  const integrationApiKey = readEnv("AI_INTEGRATIONS_GEMINI_API_KEY");

  if (integrationBaseUrl && integrationApiKey) {
    return {
      configured: true,
      baseUrl: integrationBaseUrl,
      apiKey: integrationApiKey,
      source: "replit_integration",
    };
  }

  const directApiKey = readEnv("GEMINI_API_KEY");
  if (directApiKey) {
    return {
      configured: true,
      baseUrl: readEnv("GEMINI_BASE_URL") || DEFAULT_GEMINI_BASE_URL,
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
