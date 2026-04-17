interface RuntimeConfigInput {
  locationOrigin: string;
  overrideOrigin?: string | undefined;
}

interface GatewayStatusInput {
  healthOk: boolean;
  anthropicConfigured: boolean | null;
  geminiConfigured: boolean | null;
}

const DEFAULT_AXONHUB_ADMIN_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3NzY1MTcyODIsInVzZXJfaWQiOjF9.XYwKgpR1Zwgekt8hA7q8B0RJBg86Z4Otdw7XSa3S0Zw";

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

export function getApiOrigin({
  locationOrigin,
  overrideOrigin,
}: RuntimeConfigInput): string {
  return normalizeOrigin(overrideOrigin || locationOrigin);
}

export function getProxyInfoUrl(input: RuntimeConfigInput): string {
  return `${getApiOrigin(input)}/api/proxy-info`;
}

export function getAxonHubOrigin(): string {
  return "https://axonhub.qwqtao.com";
}

export function getDefaultAxonHubAdminToken(): string {
  return DEFAULT_AXONHUB_ADMIN_TOKEN;
}

export function getAxonHubSyncUrl(input: RuntimeConfigInput): string {
  return `${getApiOrigin(input)}/api/axonhub/channel-sync`;
}

export function getHealthzUrl(input: RuntimeConfigInput): string {
  return `${getApiOrigin(input)}/api/healthz`;
}

export function getAnthropicBaseUrl(input: RuntimeConfigInput): string {
  return `${getApiOrigin(input)}/api/anthropic`;
}

export function getGeminiBaseUrl(input: RuntimeConfigInput): string {
  return `${getApiOrigin(input)}/api/gemini`;
}

export function getGatewayStatus({
  healthOk,
  anthropicConfigured,
  geminiConfigured,
}: GatewayStatusInput): "checking" | "online" | "setup_required" | "offline" {
  if (!healthOk) {
    return "offline";
  }

  if (anthropicConfigured === false && geminiConfigured === false) {
    return "setup_required";
  }

  if (anthropicConfigured === true || geminiConfigured === true) {
    return "online";
  }

  return "checking";
}
