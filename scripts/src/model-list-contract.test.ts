import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ANTHROPIC_MODELS } from "../../artifacts/api-server/src/lib/anthropic-request.ts";
import {
  AXONHUB_DEFAULT_TEST_MODEL,
  AXONHUB_SUPPORTED_MODELS,
} from "../../artifacts/api-server/src/lib/axonhub.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

test("claude-opus-4-7 is exposed consistently across backend and status-page model lists", async () => {
  assert.equal(ANTHROPIC_MODELS[0], "claude-opus-4-7");
  assert.equal(AXONHUB_SUPPORTED_MODELS[0], "claude-opus-4-7");
  assert.equal(AXONHUB_DEFAULT_TEST_MODEL, "claude-opus-4-5");

  const statusPageSource = await readFile(
    path.join(repoRoot, "artifacts", "status-page", "src", "pages", "status-page.tsx"),
    "utf8",
  );

  assert.match(statusPageSource, /"claude-opus-4-7"/);
  assert.match(
    statusPageSource,
    /supportedModels=claude-opus-4-7 \/ claude-opus-4-6 \/ claude-opus-4-5 \/ claude-sonnet-4-6/,
  );
});
