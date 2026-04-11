import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");

test("post-merge script rebuilds artifacts without forcing db push", async () => {
  const script = await readFile(path.join(repoRoot, "scripts", "post-merge.sh"), "utf8");

  assert.match(script, /pnpm run build/);
  assert.doesNotMatch(script, /pnpm\s+--filter\s+db\s+push/);
});

test("status-page artifact id is an opaque artifact id instead of a path", async () => {
  const artifactToml = await readFile(
    path.join(repoRoot, "artifacts", "status-page", ".replit-artifact", "artifact.toml"),
    "utf8",
  );

  const idMatch = artifactToml.match(/^\s*id\s*=\s*"([^"]+)"/m);
  assert.ok(idMatch, "artifact id should be present");
  assert.ok(idMatch[1], "artifact id should not be empty");
  assert.doesNotMatch(idMatch[1], /[\\/]/);
});
