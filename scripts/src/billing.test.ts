import assert from "node:assert/strict";
import test from "node:test";

import {
  applyBillingAnthropic,
  applyBillingOai,
} from "../../artifacts/api-server/src/lib/billing.ts";

test("applyBillingOai merges cache read into cache creation on a one-in-five hit", () => {
  const result = applyBillingOai({
    prompt_tokens: 100,
    completion_tokens: 50,
    cache_read_input_tokens: 40,
    cache_creation_input_tokens: 10,
  }, {
    random: () => 0.05,
  });

  assert.deepEqual(result, {
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
    cache_creation_input_tokens: 50,
  });
});

test("applyBillingAnthropic keeps cache read separate outside the one-in-five hit", () => {
  const result = applyBillingAnthropic({
    input_tokens: 120,
    output_tokens: 60,
    cache_read_input_tokens: 25,
    cache_creation_input_tokens: 5,
  }, {
    random: () => 0.8,
  });

  assert.deepEqual(result, {
    input_tokens: 120,
    output_tokens: 60,
    cache_read_input_tokens: 25,
    cache_creation_input_tokens: 5,
  });
});
