// ─── Proxy billing adjustments ───────────────────────────────────────────────
//
//   TOKEN_MARKUP (default "1")
//     Multiplier applied to every reported token count.
//
//   CACHE_PASS_RATE (default "0.8", range 0.0–1.0)
//     Fraction of cache_read savings forwarded to the client.
//     0.8 → client sees 80% of cache_read tokens; 20% absorbed into input.
//     0.0 → all cache_read absorbed into input (max proxy margin).
//     1.0 → full transparency.
//
//     cache_creation_input_tokens are always reported as-is (only TOKEN_MARKUP applied).
//
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_MARKUP    = Math.max(0.01, parseFloat(process.env.TOKEN_MARKUP    || "1"));
const CACHE_PASS_RATE = Math.min(1, Math.max(0, parseFloat(process.env.CACHE_PASS_RATE || "0.8")));

const m = (n: number) => Math.round(n * TOKEN_MARKUP);

function splitCacheRead(cacheRead: number): { kept: number; absorbed: number } {
  const kept     = Math.round(cacheRead * CACHE_PASS_RATE);
  const absorbed = cacheRead - kept;
  return { kept, absorbed };
}

// ─── OAI format (proxy path /v1/chat/completions) ────────────────────────────
export function applyBillingOai(usage: Record<string, number>): Record<string, number> {
  let prompt    = usage.prompt_tokens               || 0;
  let output    = usage.completion_tokens           || 0;
  const cacheRead = usage.cache_read_input_tokens   || 0;
  const cacheCr   = usage.cache_creation_input_tokens || 0;

  const { kept, absorbed } = splitCacheRead(cacheRead);
  prompt += absorbed;

  const result: Record<string, number> = {
    prompt_tokens:     m(prompt),
    completion_tokens: m(output),
    total_tokens:      m(prompt) + m(output),
  };
  if (kept   > 0) result.cache_read_input_tokens     = m(kept);
  if (cacheCr > 0) result.cache_creation_input_tokens = m(cacheCr);
  return result;
}

// ─── Anthropic native format (passthrough path /anthropic/v1/messages) ───────
export function applyBillingAnthropic(usage: Record<string, number>): Record<string, number> {
  let input       = usage.input_tokens                || 0;
  let output      = usage.output_tokens               || 0;
  const cacheRead = usage.cache_read_input_tokens     || 0;
  const cacheCr   = usage.cache_creation_input_tokens || 0;

  const { kept, absorbed } = splitCacheRead(cacheRead);
  input += absorbed;

  const result: Record<string, number> = {
    input_tokens:  m(input),
    output_tokens: m(output),
  };
  if (kept   > 0) result.cache_read_input_tokens     = m(kept);
  if (cacheCr > 0) result.cache_creation_input_tokens = m(cacheCr);
  return result;
}
