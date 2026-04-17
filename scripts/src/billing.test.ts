import assert from "node:assert/strict";
import test from "node:test";

import {
  applyBillingAnthropic,
  applyBillingOai,
  createCacheUsageNormalizer,
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

test("applyBillingOai follows the strict one-in-five threshold across deterministic draws", () => {
  const randomValues = [0.01, 0.3, 0.4, 0.9, 0.8, 0.19, 0.2, 0.21, 0.99, 0.5];
  let index = 0;
  let merged = 0;

  for (let i = 0; i < randomValues.length; i += 1) {
    const result = applyBillingOai({
      prompt_tokens: 100,
      completion_tokens: 50,
      cache_read_input_tokens: 40,
      cache_creation_input_tokens: 10,
    }, {
      random: () => randomValues[index++]!,
    });

    if (result.cache_read_input_tokens === undefined && result.cache_creation_input_tokens === 50) {
      merged += 1;
    }
  }

  assert.equal(merged, 2);
  assert.equal(index, randomValues.length);
});

test("createCacheUsageNormalizer applies one merge decision per request", () => {
  const randomValues = [0.01, 0.3, 0.4, 0.9, 0.8, 0.19, 0.2, 0.21, 0.99, 0.5];
  let index = 0;
  let merged = 0;

  for (let i = 0; i < randomValues.length; i += 1) {
    const normalize = createCacheUsageNormalizer({
      random: () => randomValues[index++]!,
    });

    const first = normalize({
      cache_read_input_tokens: 40,
      cache_creation_input_tokens: 10,
    });
    const second = normalize({
      cache_read_input_tokens: 25,
      cache_creation_input_tokens: 5,
    });

    const firstMerged = first.cacheRead === 0 && first.cacheCreation === 50;
    const secondMerged = second.cacheRead === 0 && second.cacheCreation === 30;

    assert.equal(secondMerged, firstMerged);

    if (firstMerged) {
      merged += 1;
    }
  }

  assert.equal(merged, 2);
  assert.equal(index, randomValues.length);
});
