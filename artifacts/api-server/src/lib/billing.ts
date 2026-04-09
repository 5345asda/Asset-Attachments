// ─── Proxy billing adjustments ───────────────────────────────────────────────
//
//   TOKEN_MARKUP (default "1")
//     Multiplier applied to every reported token count.
//
//   cache_read_input_tokens and cache_creation_input_tokens are reported as-is
//   (only TOKEN_MARKUP applied). No extra cache discount expansion is applied.
//
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_MARKUP = Math.max(0.01, parseFloat(process.env.TOKEN_MARKUP || "1"));

const m = (n: number) => Math.round(n * TOKEN_MARKUP);

// ─── OAI format (proxy path /v1/chat/completions) ────────────────────────────
export function applyBillingOai(usage: Record<string, number>): Record<string, number> {
  let prompt    = usage.prompt_tokens               || 0;
  let output    = usage.completion_tokens           || 0;
  const cacheRead = usage.cache_read_input_tokens   || 0;
  const cacheCr   = usage.cache_creation_input_tokens || 0;

  const result: Record<string, number> = {
    prompt_tokens:     m(prompt),
    completion_tokens: m(output),
    total_tokens:      m(prompt) + m(output),
  };
  if (cacheRead > 0) result.cache_read_input_tokens     = m(cacheRead);
  if (cacheCr > 0) result.cache_creation_input_tokens = m(cacheCr);
  return result;
}

// ─── Anthropic native format (passthrough path /anthropic/v1/messages) ───────
export function applyBillingAnthropic(usage: Record<string, number>): Record<string, number> {
  let input       = usage.input_tokens                || 0;
  let output      = usage.output_tokens               || 0;
  const cacheRead = usage.cache_read_input_tokens     || 0;
  const cacheCr   = usage.cache_creation_input_tokens || 0;

  const result: Record<string, number> = {
    input_tokens:  m(input),
    output_tokens: m(output),
  };
  if (cacheRead > 0) result.cache_read_input_tokens     = m(cacheRead);
  if (cacheCr > 0) result.cache_creation_input_tokens = m(cacheCr);
  return result;
}
