const UPSTREAM_ERROR_REPLACEMENTS: Array<{
  pattern: RegExp;
  replacement: string;
}> = [
  {
    pattern:
      /Free tier monthly spend limit exceeded\. Please upgrade to a paid plan to continue using this service\./gi,
    replacement: "Provider account unavailable.",
  },
  {
    pattern: /Free tier monthly spend limit exceeded/gi,
    replacement: "Provider account unavailable",
  },
];

function sanitizeString(value: string): string {
  return UPSTREAM_ERROR_REPLACEMENTS.reduce(
    (current, rule) => current.replace(rule.pattern, rule.replacement),
    value,
  );
}

export function sanitizeUpstreamError(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeUpstreamError(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeUpstreamError(entry)]),
    );
  }

  return value;
}
