import { readFileSync, existsSync } from "node:fs";
import { parse } from "jsonc-parser";
export function inspect(config, environment, release, policies) {
  const failures = [];
  if (!["staging", "production"].includes(environment))
    return [
      "Specify staging or production explicitly. The development configuration must never be deployed.",
    ];
  const target = config.env?.[environment];
  if (!target) return [`Missing ${environment} configuration.`];
  const vars = target.vars ?? {},
    other = config.env?.[environment === "staging" ? "production" : "staging"];
  let origin;
  try {
    origin = new URL(vars.PUBLIC_ORIGIN);
  } catch {}
  if (
    !origin ||
    origin.protocol !== "https:" ||
    origin.pathname !== "/" ||
    /\.example$|localhost|127\.0\.0\.1/.test(origin.hostname)
  )
    failures.push("Configure the real HTTPS origin.");
  if (vars.ENVIRONMENT !== environment || vars.ALLOW_DEV_LOGIN !== "false")
    failures.push("Disable development login and use the correct environment.");
  if (!["disabled", "live"].includes(vars.PROVIDER_MODE))
    failures.push("Fixture mode is forbidden outside local development.");
  if (
    (environment === "production" || vars.PROVIDER_MODE === "live") &&
    (!vars.TURNSTILE_SITE_KEY || /^[123]x0{8}/.test(vars.TURNSTILE_SITE_KEY))
  )
    failures.push(
      "Configure a real Turnstile site key for this environment; provision the matching secret and verify the exact hostname before opening creation.",
    );
  if (vars.PAYMENTS_ENABLED !== "false") {
    if (vars.PAYMENTS_ENABLED !== "true")
      failures.push("Set an explicit payments switch.");
    if (environment === "staging" && vars.PADDLE_ENVIRONMENT !== "sandbox")
      failures.push("Staging checkout must use the Paddle sandbox.");
    if (vars.REFERENCE_GENERATION_ENABLED !== "true")
      failures.push(
        "Do not sell points before reference-guided fulfillment is available.",
      );
    if (environment === "production") {
      if (
        vars.PADDLE_ENVIRONMENT !== "production" ||
        vars.PADDLE_LIVE_APPROVED !== "true"
      )
        failures.push(
          "Real payments require explicit merchant activation and owner approval.",
        );
      for (const key of [
        "paddleSandboxCheckout",
        "paddleRefund",
        "paddleDuplicateEvents",
        "paddleOrderRecovery",
        "paddleCatalogVerified",
        "paidReferenceFulfillment",
        "purchaseTerms",
      ])
        if (!release?.checks?.[key])
          failures.push(`Payment release evidence is missing: ${key}.`);
    }
  }
  if (
    vars.REFERENCE_GENERATION_ENABLED === "true" &&
    environment === "production" &&
    !release?.checks?.providerCostCeiling
  )
    failures.push(
      "Reference generation requires verified input pricing and a provider cost ceiling.",
    );
  const id = target.d1_databases?.find((b) => b.binding === "DB")?.database_id;
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      id ?? "",
    ) ||
    /^00000000/.test(id)
  )
    failures.push("Set a real environment-specific D1 database ID.");
  if (id === other?.d1_databases?.[0]?.database_id)
    failures.push("Staging and production cannot share a database.");
  if (
    !target.r2_buckets?.some((b) => b.binding === "MEDIA") ||
    target.r2_buckets?.[0]?.bucket_name === other?.r2_buckets?.[0]?.bucket_name
  )
    failures.push("Configure a separate media bucket.");
  if (
    !target.workflows?.some((w) => w.binding === "GENERATION") ||
    !target.workflows?.some((w) => w.binding === "ARCHIVES") ||
    !target.durable_objects?.bindings?.some((b) => b.name === "STORY_ROOMS")
  )
    failures.push(
      "Configure the story coordinator, generation and archive Workflows.",
    );
  if (
    vars.PROVIDER_MODE === "live" &&
    (!release?.approvedBudgetCents || !release?.testApprovedAt)
  )
    failures.push(
      "Live staging tests need a dated, explicit spending authorization.",
    );
  if (environment === "production") {
    if (
      policies?.status !== "final" ||
      !policies?.operatorName ||
      !policies?.effectiveAt ||
      !policies?.contactEmail ||
      policies.contactEmail !== vars.SUPPORT_EMAIL
    )
      failures.push(
        "Finalize versioned policies, operator identity, effective date and a matching public support contact.",
      );
    if (!vars.SUPPORT_EMAIL || !vars.SUPPORT_EMAIL.includes("@"))
      failures.push("Configure a working support contact.");
    const checks = [
      "googleLogin",
      "actualEnglishVideo",
      "characterContinuity",
      "newCharacterEntrance",
      "crossSceneTransition",
      "mediaRecovery",
      "budgetCutoff",
      "providerCostCeiling",
      "legalPolicies",
      "mobilePlayback",
      "accountRequests",
      "abuseProtection",
      "cloudResourceSmokeTest",
    ];
    for (const key of checks)
      if (!release?.checks?.[key])
        failures.push(`Release evidence is missing: ${key}.`);
    if (!release?.approvedBudgetCents || release.approvedBudgetCents <= 0)
      failures.push(
        "Record the explicitly authorized test/launch spending ceiling.",
      );
    if (!release?.evidence || !release?.reviewedAt)
      failures.push(
        "Record dated acceptance evidence before opening live generation.",
      );
  }
  return failures;
}
if (process.argv[1]?.endsWith("preflight.mjs")) {
  const errors = [];
  const config = parse(readFileSync("wrangler.jsonc", "utf8"), errors, {
    allowTrailingComma: true,
  });
  if (errors.length) throw new Error("Invalid Wrangler JSONC configuration.");
  const release = existsSync("release.acceptance.json")
    ? JSON.parse(readFileSync("release.acceptance.json", "utf8"))
    : null;
  const policies = JSON.parse(readFileSync("shared/policies.json", "utf8"));
  const failures = inspect(config, process.argv[2], release, policies);
  if (failures.length) {
    console.error(
      "Deployment is not ready:\n" + failures.map((x) => `- ${x}`).join("\n"),
    );
    process.exitCode = 1;
  } else
    console.log(
      "Static deployment preflight passed. Provisioned secrets and remote migration checks are still required.",
    );
}
