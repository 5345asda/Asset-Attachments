// ─── Proxy billing adjustments ───────────────────────────────────────────────
//
//   TOKEN_MARKUP (default "1")
//     Multiplier applied to every reported token count.
//
//   On a one-in-five hit, cache_read_input_tokens are merged into
//   cache_creation_input_tokens and cache_read_input_tokens are hidden.
//   Otherwise both values are reported as-is.
//
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_MARKUP = Math.max(0.01, parseFloat(process.env.TOKEN_MARKUP || "1"));
const CACHE_READ_TO_WRITE_RATE = 0.2;

const m = (n: number) => Math.round(n * TOKEN_MARKUP);

type CacheUsage = {
  cacheRead: number;
  cacheCreation: number;
};

type BillingOptions = {
  random?: () => number;
  cacheAlreadyNormalized?: boolean;
};

function shouldMergeCacheRead(random: () => number): boolean {
  return random() < CACHE_READ_TO_WRITE_RATE;
}

function normalizeCacheUsage(
  cacheRead: number,
  cacheCreation: number,
  random: () => number,
): CacheUsage {
  if (cacheRead > 0 && shouldMergeCacheRead(random)) {
    return {
      cacheRead: 0,
      cacheCreation: cacheCreation + cacheRead,
    };
  }

  return { cacheRead, cacheCreation };
}

export function createCacheUsageNormalizer(options?: { random?: () => number }) {
  const random = options?.random ?? Math.random;
  let mergeCacheRead: boolean | undefined;

  return (usage: Record<string, number>): CacheUsage => {
    const cacheRead = usage.cache_read_input_tokens || 0;
    const cacheCreation = usage.cache_creation_input_tokens || 0;

    if (cacheRead <= 0) {
      return { cacheRead, cacheCreation };
    }

    if (mergeCacheRead === undefined) {
      mergeCacheRead = shouldMergeCacheRead(random);
    }

    return mergeCacheRead
      ? { cacheRead: 0, cacheCreation: cacheCreation + cacheRead }
      : { cacheRead, cacheCreation };
  };
}

// ─── OAI format (proxy path /v1/chat/completions) ────────────────────────────
export function applyBillingOai(
  usage: Record<string, number>,
  options?: BillingOptions,
): Record<string, number> {
  let prompt    = usage.prompt_tokens               || 0;
  let output    = usage.completion_tokens           || 0;
  const random = options?.random ?? Math.random;
  const normalizedCache = options?.cacheAlreadyNormalized
    ? {
        cacheRead: usage.cache_read_input_tokens || 0,
        cacheCreation: usage.cache_creation_input_tokens || 0,
      }
    : normalizeCacheUsage(
        usage.cache_read_input_tokens || 0,
        usage.cache_creation_input_tokens || 0,
        random,
      );

  const result: Record<string, number> = {
    prompt_tokens:     m(prompt),
    completion_tokens: m(output),
    total_tokens:      m(prompt) + m(output),
  };
  if (normalizedCache.cacheRead > 0) result.cache_read_input_tokens = m(normalizedCache.cacheRead);
  if (normalizedCache.cacheCreation > 0) {
    result.cache_creation_input_tokens = m(normalizedCache.cacheCreation);
  }
  return result;
}

// ─── Anthropic native format (passthrough path /anthropic/v1/messages) ───────
export function applyBillingAnthropic(
  usage: Record<string, number>,
  options?: BillingOptions,
): Record<string, number> {
  let input       = usage.input_tokens                || 0;
  let output      = usage.output_tokens               || 0;
  const random = options?.random ?? Math.random;
  const normalizedCache = options?.cacheAlreadyNormalized
    ? {
        cacheRead: usage.cache_read_input_tokens || 0,
        cacheCreation: usage.cache_creation_input_tokens || 0,
      }
    : normalizeCacheUsage(
        usage.cache_read_input_tokens || 0,
        usage.cache_creation_input_tokens || 0,
        random,
      );

  const result: Record<string, number> = {
    input_tokens:  m(input),
    output_tokens: m(output),
  };
  if (normalizedCache.cacheRead > 0) result.cache_read_input_tokens = m(normalizedCache.cacheRead);
  if (normalizedCache.cacheCreation > 0) {
    result.cache_creation_input_tokens = m(normalizedCache.cacheCreation);
  }
  return result;
}
