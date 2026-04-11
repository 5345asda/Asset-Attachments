interface RuntimeConfigInput {
  locationOrigin: string;
  overrideOrigin?: string | undefined;
}

interface GatewayStatusInput {
  healthOk: boolean;
  anthropicConfigured: boolean | null;
}

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

export function getHealthzUrl(input: RuntimeConfigInput): string {
  return `${getApiOrigin(input)}/api/healthz`;
}

export function getAnthropicBaseUrl(input: RuntimeConfigInput): string {
  return `${getApiOrigin(input)}/api/anthropic`;
}

export function getGatewayStatus({
  healthOk,
  anthropicConfigured,
}: GatewayStatusInput): "checking" | "online" | "setup_required" | "offline" {
  if (!healthOk) {
    return "offline";
  }

  if (anthropicConfigured === false) {
    return "setup_required";
  }

  if (anthropicConfigured === true) {
    return "online";
  }

  return "checking";
}
