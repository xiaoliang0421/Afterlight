import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
test("development config cannot be deployed and staging placeholders fail preflight", () => {
  for (const env of ["development", "staging", "production"]) {
    const result = spawnSync(process.execPath, ["scripts/preflight.mjs", env], {
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Deployment is not ready/);
    if (env === "production") assert.match(result.stderr, /actualEnglishVideo/);
  }
});
