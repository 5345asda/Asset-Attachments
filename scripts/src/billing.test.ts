import assert from "node:assert/strict";
import test from "node:test";

import {
  applyBillingAnthropic,
  applyBillingOai,
} from "../../artifacts/api-server/src/lib/billing.ts";

test("applyBillingOai keeps cache tokens fully transparent", () => {
  const result = applyBillingOai({
    prompt_tokens: 100,
    completion_tokens: 50,
    cache_read_input_tokens: 40,
    cache_creation_input_tokens: 10,
  });

  assert.deepEqual(result, {
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
    cache_read_input_tokens: 40,
    cache_creation_input_tokens: 10,
  });
});

test("applyBillingAnthropic keeps cache tokens fully transparent", () => {
  const result = applyBillingAnthropic({
    input_tokens: 120,
    output_tokens: 60,
    cache_read_input_tokens: 25,
    cache_creation_input_tokens: 5,
  });

  assert.deepEqual(result, {
    input_tokens: 120,
    output_tokens: 60,
    cache_read_input_tokens: 25,
    cache_creation_input_tokens: 5,
  });
});
