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
} from "../../artifacts/api-server/src/lib/axonhub.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

test("AxonHub status-page copy stays aligned with the backend sync model lists", async () => {
  assert.equal(ANTHROPIC_MODELS[0], "claude-opus-4-7");
  assert.equal(AXONHUB_SUPPORTED_MODELS[0], "claude-opus-4-7");
  assert.equal(AXONHUB_DEFAULT_TEST_MODEL, "claude-opus-4-5");
  assert.equal(AXONHUB_GEMINI_SUPPORTED_MODELS[0], "gemini-2.5-pro");
  assert.equal(AXONHUB_GEMINI_DEFAULT_TEST_MODEL, "gemini-2.5-flash");

  const statusPageSource = await readFile(
    path.join(repoRoot, "artifacts", "status-page", "src", "pages", "status-page.tsx"),
    "utf8",
  );

  assert.match(statusPageSource, /gemini:anthropic = 8:1/);
  assert.match(statusPageSource, /Auto 8:1 routing/);
  assert.match(statusPageSource, /"claude-opus-4-7"/);
  assert.match(statusPageSource, /supportedModels=gemini-2.5-pro \/ gemini-2.5-flash/);
  assert.match(
    statusPageSource,
    /supportedModels=claude-opus-4-7 \/ claude-opus-4-6 \/ claude-opus-4-5 \/ claude-sonnet-4-6/,
  );
});
