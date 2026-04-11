interface RuntimeConfigInput {
  locationOrigin: string;
  overrideOrigin?: string | undefined;
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
