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
  assert.doesNotMatch(production, /actualEnglishVideo/);
  assert.match(production, /contentPublicationReview/);
  const generation = structuredClone(config);
  generation.env.production.vars.PROVIDER_MODE = "live";
  assert.match(
    inspect(generation, "production", null, policies).join("\n"),
    /actualEnglishVideo/,
  );
  assert.match(production, /Finalize versioned policies/);
  assert.match(production, /legalPolicies/);
});

test("upload-only launch passes only with all applicable evidence and final policy details", () => {
  const config = parse(readFileSync("wrangler.jsonc", "utf8"));
  const vars = config.env.production.vars;
  vars.PUBLIC_ORIGIN = "https://launch.fixture.invalid";
  vars.TURNSTILE_SITE_KEY = "fixture-site-key-for-static-test";
  const finalPolicies = {
    ...policies,
    status: "final",
    operatorName: "Synthetic operator",
    effectiveAt: "2026-09-08",
  };
  const checks = Object.fromEntries(
    [
      "googleLogin",
      "mediaRecovery",
      "legalPolicies",
      "mobilePlayback",
      "accountRequests",
      "abuseProtection",
      "cloudResourceSmokeTest",
      "hostUploadFulfillment",
      "invitationAccess",
      "publicMetadataReview",
      "contentPublicationReview",
      "reportTakedown",
    ].map((name) => [name, true]),
  );
  const release = {
    checks,
    evidence: "Synthetic unit-test evidence only",
    reviewedAt: "2026-09-08",
  };
  assert.deepEqual(inspect(config, "production", release, finalPolicies), []);
  for (const key of [
    "invitationAccess",
    "publicMetadataReview",
    "contentPublicationReview",
    "reportTakedown",
  ]) {
    assert.match(
      inspect(
        config,
        "production",
        { ...release, checks: { ...checks, [key]: false } },
        finalPolicies,
      ).join("\n"),
      new RegExp(key),
    );
  }
  vars.PROVIDER_MODE = "live";
  assert.match(
    inspect(config, "production", release, finalPolicies).join("\n"),
    /actualEnglishVideo/,
  );
});
