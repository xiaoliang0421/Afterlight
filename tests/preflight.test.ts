import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";
import { inspect } from "../scripts/preflight.mjs";
import policies from "../shared/policies.json";
test("preflight rejects development, missing remote resources and unaccepted production even after staging is provisioned", () => {
  const config = parse(readFileSync("wrangler.jsonc", "utf8"));
  assert.deepEqual(inspect(config, "staging", null, policies), []);
  assert.ok(inspect(config, "development", null, policies).length);
  const missing = structuredClone(config);
  missing.env.staging.vars.PUBLIC_ORIGIN = "https://configure-staging.example";
  missing.env.staging.d1_databases[0].database_id =
    "REPLACE_STAGING_DATABASE_ID";
  assert.match(
    inspect(missing, "staging", null, policies).join("\n"),
    /real HTTPS origin/,
  );
  assert.match(
    inspect(missing, "staging", null, policies).join("\n"),
    /D1 database ID/,
  );
  const live = structuredClone(config);
  live.env.staging.vars.PROVIDER_MODE = "live";
  delete live.env.staging.vars.TURNSTILE_SITE_KEY;
  assert.match(
    inspect(live, "staging", null, policies).join("\n"),
    /Turnstile/,
  );
  assert.match(
    inspect(live, "staging", null, policies).join("\n"),
    /spending authorization/,
  );
  const production = inspect(config, "production", null, policies).join("\n");
  assert.match(production, /actualEnglishVideo/);
  assert.match(production, /Finalize versioned policies/);
  assert.match(production, /legalPolicies/);
});
