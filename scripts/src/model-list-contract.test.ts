import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ANTHROPIC_MODELS } from "../../artifacts/api-server/src/lib/anthropic-request.ts";
import {
  AXONHUB_DEFAULT_TEST_MODEL,
  AXONHUB_SUPPORTED_MODELS,
  AXONHUB_GEMINI_DEFAULT_TEST_MODEL,
  AXONHUB_GEMINI_SUPPORTED_MODELS,
  AXONHUB_OPENROUTER_DEFAULT_TEST_MODEL,
  AXONHUB_OPENROUTER_SUPPORTED_MODELS,
} from "../../artifacts/api-server/src/lib/axonhub.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const EXPECTED_AXONHUB_GEMINI_MODELS = [
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3-pro-image-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-image",
] as const;
const EXPECTED_AXONHUB_OPENROUTER_MODELS = [
  "moonshotai/kimi-k2.6",
  "moonshotai/kimi-k2.5",
  "qwen/qwen3.6-flash",
  "qwen/qwen3.6-35b-a3b",
  "qwen/qwen3.6-max-preview",
  "z-ai/glm-5.1",
  "z-ai/glm-5v-turbo",
  "z-ai/glm-5-turbo",
  "z-ai/glm-5",
  "z-ai/glm-4.7-flash",
  "z-ai/glm-4.7",
  "openai/gpt-5.4-nano",
  "openai/gpt-5.4-pro",
  "openai/gpt-4o",
  "x-ai/grok-4.20-multi-agent",
  "x-ai/grok-4.20",
  "deepseek/deepseek-v4-pro",
  "deepseek/deepseek-v4-flash",
  "deepseek/deepseek-v3.2",
  "deepseek/deepseek-v3.2-exp",
  "deepseek/deepseek-r1",
  "deepseek/deepseek-r1-0528",
  "minimax/minimax-m2.7",
  "minimax/minimax-m2.5",
  "xiaomi/mimo-v2.5",
  "xiaomi/mimo-v2.5-pro",
] as const;

test("AxonHub status-page copy stays aligned with the backend sync model lists", async () => {
  assert.equal(ANTHROPIC_MODELS[0], "claude-opus-4-7");
  assert.equal(AXONHUB_SUPPORTED_MODELS[0], "claude-opus-4-7");
  assert.equal(AXONHUB_DEFAULT_TEST_MODEL, "claude-opus-4-5");
  assert.deepEqual(AXONHUB_GEMINI_SUPPORTED_MODELS, EXPECTED_AXONHUB_GEMINI_MODELS);
  assert.equal(AXONHUB_GEMINI_DEFAULT_TEST_MODEL, "gemini-2.5-flash");
  assert.deepEqual(AXONHUB_OPENROUTER_SUPPORTED_MODELS, EXPECTED_AXONHUB_OPENROUTER_MODELS);
  assert.equal(AXONHUB_OPENROUTER_DEFAULT_TEST_MODEL, "z-ai/glm-4.7");

  const statusPageSource = await readFile(
    path.join(repoRoot, "artifacts", "status-page", "src", "pages", "status-page.tsx"),
    "utf8",
  );

  assert.match(statusPageSource, /Dynamic archived-share routing/);
  assert.match(statusPageSource, /各 provider 至少保留 10 个 enabled channel/);
  assert.match(statusPageSource, /archived 越多代表历史使用越多/);
  assert.match(statusPageSource, /优先补给 archived 占比更高、但 enabled 占比偏低的 provider/);
  assert.doesNotMatch(statusPageSource, /anthropic:openrouter:gemini = 8:1:2/);
  assert.doesNotMatch(statusPageSource, /Auto 8:1:2 routing/);
  assert.match(statusPageSource, /"claude-opus-4-7"/);
  assert.match(
    statusPageSource,
    /supportedModels=gemini-3\.1-pro-preview \/ gemini-3-flash-preview \/ gemini-3-pro-image-preview \/ gemini-2\.5-pro \/ gemini-2\.5-flash \/ gemini-2\.5-flash-image/,
  );
  assert.match(
    statusPageSource,
    /defaultTestModel=z-ai\/glm-4\.7/,
  );
  assert.match(
    statusPageSource,
    /supportedModels=moonshotai\/kimi-k2\.6 \/ moonshotai\/kimi-k2\.5 \/ qwen\/qwen3\.6-flash \/ qwen\/qwen3\.6-35b-a3b \/ qwen\/qwen3\.6-max-preview \/ z-ai\/glm-5\.1 \/ z-ai\/glm-5v-turbo \/ z-ai\/glm-5-turbo \/ z-ai\/glm-5 \/ z-ai\/glm-4\.7-flash \/ z-ai\/glm-4\.7 \/ openai\/gpt-5\.4-nano \/ openai\/gpt-5\.4-pro \/ openai\/gpt-4o \/ x-ai\/grok-4\.20-multi-agent \/ x-ai\/grok-4\.20 \/ deepseek\/deepseek-v4-pro \/ deepseek\/deepseek-v4-flash \/ deepseek\/deepseek-v3\.2 \/ deepseek\/deepseek-v3\.2-exp \/ deepseek\/deepseek-r1 \/ deepseek\/deepseek-r1-0528 \/ minimax\/minimax-m2\.7 \/ minimax\/minimax-m2\.5 \/ xiaomi\/mimo-v2\.5 \/ xiaomi\/mimo-v2\.5-pro/,
  );
  assert.match(
    statusPageSource,
    /supportedModels=claude-opus-4-7 \/ claude-opus-4-6 \/ claude-opus-4-5 \/ claude-sonnet-4-6/,
  );
  assert.match(statusPageSource, /settings\.passThroughUserAgent=inherit/);
  assert.match(statusPageSource, /settings\.passThroughBody=false/);
});
