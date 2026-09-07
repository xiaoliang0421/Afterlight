import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { admin, refreshBalance } from "../worker/admin";
import type { AppEnv } from "../worker/auth";
import { normalizeError } from "../worker/errors";
import { adaptD1, migrateFixture } from "./support/database";

function setup() {
  const db = new DatabaseSync(":memory:");
  migrateFixture(db);
  db.exec(
    "UPDATE provider_wallet SET balance_cents=1000,checked_at=1,reserved_cents=123,debited_cents=42 WHERE id=1",
  );
  const env = {
    DB: adaptD1(db),
    ENVIRONMENT: "staging",
    PROVIDER_MODE: "disabled",
    FAL_KEY: "synthetic-generation-key",
    FAL_ADMIN_KEY: "synthetic-balance-key",
  } as unknown as Cloudflare.Env;
  const wallet = () =>
    db.prepare("SELECT * FROM provider_wallet WHERE id=1").get()!;
  return { db, env, wallet };
}

test("balance refresh is read-only upstream and preserves unreconciled costs while generation is disabled", async (t) => {
  const { db, env, wallet } = setup();
  t.after(() => db.close());
  const before = wallet();
  let calls = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (
      url: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      calls++;
      assert.equal(
        String(url),
        "https://api.fal.ai/v1/account/billing?expand=credits",
      );
      assert.equal(init?.method ?? "GET", "GET");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Key synthetic-balance-key",
      );
      return Response.json({
        credits: { current_balance: 6.779, currency: "USD" },
      });
    },
  );
  const started = Date.now();
  await refreshBalance(env);
  const after = wallet();
  assert.equal(calls, 1);
  assert.equal(after.balance_cents, 677);
  assert.ok(Number(after.checked_at) >= started);
  assert.equal(after.reserved_cents, before.reserved_cents);
  assert.equal(after.debited_cents, before.debited_cents);
});

test("missing balance credentials never fall back to the generation key or freshen a stale balance", async (t) => {
  const { db, env, wallet } = setup();
  t.after(() => db.close());
  const before = wallet();
  delete env.FAL_ADMIN_KEY;
  t.mock.method(globalThis, "fetch", async () => {
    assert.fail(
      "No provider request is allowed without the billing credential",
    );
  });
  await assert.rejects(refreshBalance(env), { code: "balance_key_missing" });
  assert.deepEqual(wallet(), before);
});

test("failed or invalid billing responses preserve the full wallet and its expired timestamp", async (t) => {
  const { db, env, wallet } = setup();
  t.after(() => db.close());
  const before = wallet();
  const failures = [
    () => new Response("private upstream diagnostics", { status: 403 }),
    () => new Response("{invalid-json"),
    () => Response.json({ credits: { current_balance: 50, currency: "EUR" } }),
    () =>
      Response.json({ credits: { current_balance: "50", currency: "USD" } }),
    () => {
      throw new DOMException("Provider timed out", "TimeoutError");
    },
  ];
  for (const response of failures) {
    let calls = 0;
    const mocked = t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return response();
    });
    await assert.rejects(refreshBalance(env));
    assert.equal(calls, 1, "A failed read is not silently retried");
    assert.deepEqual(wallet(), before);
    mocked.mock.restore();
  }
});

test("ordinary users cannot trigger the Studio balance refresh", async (t) => {
  const { db, env, wallet } = setup();
  t.after(() => db.close());
  const before = wallet();
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("user", {
      id: "dev-creator",
      email: "test@example.invalid",
      displayName: "Tester",
      role: "user",
      policyAccepted: true,
    });
    await next();
  });
  app.onError((error, c) => {
    const normalized = normalizeError(error);
    return c.json(
      { error: { code: normalized.code, message: normalized.message } },
      normalized.status,
    );
  });
  app.route("/api/admin", admin);
  t.mock.method(globalThis, "fetch", async () => {
    assert.fail("An ordinary account must not invoke provider administration");
  });
  const response = await app.request(
    "/api/admin/balance/refresh",
    { method: "POST" },
    env,
  );
  assert.equal(response.status, 403);
  assert.deepEqual(wallet(), before);
});
