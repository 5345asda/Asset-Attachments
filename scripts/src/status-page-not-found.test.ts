import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("status page not-found view presents 401 copy", async () => {
  const source = await readFile(
    new URL("../../artifacts/status-page/src/pages/not-found.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /401 Unauthorized/);
  assert.doesNotMatch(source, /404 Page Not Found/);
});
