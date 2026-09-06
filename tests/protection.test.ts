import test from "node:test";
import assert from "node:assert/strict";
import { verifyHuman } from "../worker/turnstile";
import { creationAction } from "../shared/protection";
const env = {
  PUBLIC_ORIGIN: "https://story.example.com",
  ENVIRONMENT: "production",
  ALLOW_DEV_LOGIN: "false",
  TURNSTILE_SITE_KEY: "test-public",
  TURNSTILE_SECRET_KEY: "test-secret",
} as unknown as Cloudflare.Env;
const request = (token = "single-use-token") =>
  new Request("https://story.example.com/api/stories", {
    headers: { "X-Turnstile-Token": token },
  });
test("creation protection covers drafts, previews and admission without intercepting signed payment events", () => {
  for (const path of [
    "/stories",
    "/stories/world/tasks",
    "/tasks/task/preview",
    "/tasks/task/accept",
  ])
    assert.ok(creationAction(path, "POST"));
  assert.equal(creationAction("/billing/webhook", "POST"), null);
  assert.equal(creationAction("/stories", "GET"), null);
});
test("Turnstile verifies secret on the server and binds success to the exact host and action", async (t) => {
  let result: unknown = {
    success: true,
    hostname: "story.example.com",
    action: "create_story",
  };
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(
      url,
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    assert.equal((init.body as URLSearchParams).get("secret"), "test-secret");
    return Response.json(result);
  });
  await verifyHuman(env, request(), "create_story");
  for (const invalid of [
    { success: false, "error-codes": ["timeout-or-duplicate"] },
    { success: true, hostname: "other.example.com", action: "create_story" },
    { success: true, hostname: "localhost", action: "create_story" },
    { success: true, hostname: "story.example.com", action: "preview_scene" },
    { success: true },
  ]) {
    result = invalid;
    await assert.rejects(
      () => verifyHuman(env, request(), "create_story"),
      /expired or failed/,
    );
  }
  await assert.rejects(
    () => verifyHuman(env, request(""), "create_story"),
    /Complete the security/,
  );
  await assert.rejects(
    () => verifyHuman(env, request("x".repeat(2049)), "create_story"),
    /Complete the security/,
  );
});
test("remote configuration errors and upstream outages fail closed; only local fixtures bypass", async (t) => {
  const missing = {
    ...env,
    TURNSTILE_SITE_KEY: undefined,
    TURNSTILE_SECRET_KEY: undefined,
  };
  await assert.rejects(
    () => verifyHuman(missing, request(), "create_story"),
    /not configured/,
  );
  const local = {
    ...missing,
    ENVIRONMENT: "development",
    PROVIDER_MODE: "fixture",
    ALLOW_DEV_LOGIN: "true",
    PUBLIC_ORIGIN: "http://127.0.0.1:8790",
  } as unknown as Cloudflare.Env;
  await verifyHuman(local, request(""), "create_story");
  await assert.rejects(
    () =>
      verifyHuman(
        { ...local, ENVIRONMENT: "staging" } as unknown as Cloudflare.Env,
        request(),
        "create_story",
      ),
    /not configured/,
  );
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Network unavailable");
  });
  await assert.rejects(
    () => verifyHuman(env, request(), "create_story"),
    /temporarily unavailable/,
  );
});
