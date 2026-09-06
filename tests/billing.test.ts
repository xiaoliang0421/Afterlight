import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createHmac } from "node:crypto";
import { unstable_splitSqlQuery } from "wrangler";
import { Hono } from "hono";
import {
  transactionEntitlement,
  verifyPaddleSignature,
  type PaddleTransaction,
} from "../worker/paddle-contract";
import {
  billing,
  receivePaddleWebhook,
  reconcilePayments,
  syncPaymentOrder,
  checkoutConfigured,
} from "../worker/billing";
import { normalizeError } from "../worker/errors";
import type { AppEnv } from "../worker/auth";
import policies from "../shared/policies.json";

const transactionId = `txn_${"a".repeat(26)}`,
  priceId = `pri_${"b".repeat(26)}`;
const expected = {
  id: "order-one",
  points: 100,
  amount_cents: 1000,
  currency: "USD",
  paddle_price_id: priceId,
  provider_transaction_id: transactionId,
};
const transaction: PaddleTransaction = {
  id: transactionId,
  status: "completed",
  currency_code: "USD",
  collection_mode: "automatic",
  custom_data: { afterlight_order_id: expected.id },
  items: [
    {
      quantity: 1,
      price: {
        id: priceId,
        billing_cycle: null,
        unit_price: { amount: 1000, currency_code: "USD" },
      },
    },
  ],
  details: {
    totals: {
      subtotal: 1000,
      discount: 0,
      credit: 0,
      tax: 100,
      grand_total: 1100,
    },
  },
  adjustments: [],
};
const clone = <T>(value: T): T => structuredClone(value);
function wire(tx: PaddleTransaction) {
  const data: any = clone(tx);
  data.items[0].price.unit_price.amount = String(
    data.items[0].price.unit_price.amount,
  );
  for (const key in data.details?.totals)
    data.details.totals[key] = String(data.details.totals[key]);
  for (const adjustment of data.adjustments)
    adjustment.totals.total = String(adjustment.totals.total);
  return { data };
}
function database() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").sort())
    for (const sql of unstable_splitSqlQuery(
      readFileSync(`migrations/${file}`, "utf8"),
    ))
      db.exec(sql);
  db.exec(readFileSync("fixtures/seed.sql", "utf8"));
  const wrapper = {
    prepare(sql: string) {
      let values: any[] = [];
      const statement = {
        bind(...args: any[]) {
          values = args;
          return statement;
        },
        async first() {
          return db.prepare(sql).get(...values) ?? null;
        },
        async all() {
          return { results: db.prepare(sql).all(...values) };
        },
        async run() {
          return db.prepare(sql).run(...values);
        },
      };
      return statement;
    },
    async batch(statements: { run: () => Promise<unknown> }[]) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const env = {
    DB: wrapper,
    PAYMENTS_ENABLED: "true",
    PADDLE_ENVIRONMENT: "sandbox",
    ENVIRONMENT: "development",
    REFERENCE_GENERATION_ENABLED: "true",
    PADDLE_CLIENT_TOKEN: "test_fake",
    PADDLE_API_KEY: "pdl_sdbx_fake",
    PADDLE_WEBHOOK_SECRET: "test-webhook-secret",
  } as unknown as Cloudflare.Env;
  db.exec(
    "UPDATE settings SET reference_generation_enabled=1,reference_points=20,reference_reserve_cents=300",
  );
  db.prepare(
    "INSERT INTO payment_packages VALUES('starter','Test points',100,1000,'USD',?,'sandbox',1)",
  ).run(priceId);
  db.prepare("UPDATE provider_wallet SET checked_at=?").run(Date.now());
  return { db, env };
}
function insertOrder(db: DatabaseSync, id = expected.id) {
  db.prepare(
    "INSERT INTO payment_orders(id,user_id,package_id,idempotency_key,environment,points,amount_cents,currency,paddle_price_id,provider_transaction_id,status,terms_version,accepted_at,created_at,updated_at) VALUES(?,'dev-creator','starter',?,'sandbox',100,1000,'USD',?,?,'pending',?,1,1,1)",
  ).run(id, id, priceId, transactionId, policies.version);
}
const wallet = (db: DatabaseSync) => ({
  ...db
    .prepare(
      "SELECT balance,reserved,spent FROM paid_credit_accounts WHERE user_id='dev-creator'",
    )
    .get(),
});

test("Paddle signatures bind exact bytes, reject replay/future timestamps, and allow rotated signatures", async () => {
  const now = Date.now(),
    ts = String(Math.floor(now / 1000)),
    raw = '{"event":"test"}';
  const signature = createHmac("sha256", "secret")
    .update(`${ts}:${raw}`)
    .digest("hex");
  await verifyPaddleSignature(
    raw,
    `ts=${ts};h1=${"0".repeat(64)};h1=${signature}`,
    "secret",
    now,
  );
  await assert.rejects(() =>
    verifyPaddleSignature(raw + " ", `ts=${ts};h1=${signature}`, "secret", now),
  );
  await assert.rejects(() =>
    verifyPaddleSignature(
      raw,
      `ts=${ts};h1=${signature}`,
      "secret",
      now + 6000,
    ),
  );
  await assert.rejects(() =>
    verifyPaddleSignature(
      raw,
      `ts=${ts};h1=${signature}`,
      "secret",
      now - 6000,
    ),
  );
});
test("only a matching completed purchase grants points; partial refunds and disputes are bounded", () => {
  assert.equal(transactionEntitlement(transaction, expected).points, 100);
  assert.equal(
    transactionEntitlement({ ...transaction, status: "paid" }, expected).points,
    0,
  );
  for (const mutate of [
    (tx: PaddleTransaction) => {
      tx.custom_data!.afterlight_order_id = "other-user-order";
    },
    (tx: PaddleTransaction) => {
      tx.currency_code = "EUR";
    },
    (tx: PaddleTransaction) => {
      tx.items[0].quantity = 2;
    },
    (tx: PaddleTransaction) => {
      tx.details!.totals.subtotal = 1;
    },
    (tx: PaddleTransaction) => {
      tx.items[0].price.billing_cycle = { interval: "month" };
    },
  ]) {
    const tx = clone(transaction);
    mutate(tx);
    assert.throws(() => transactionEntitlement(tx, expected));
  }
  const tx = clone(transaction);
  tx.adjustments.push({
    id: `adj_${"c".repeat(26)}`,
    transaction_id: transactionId,
    action: "refund",
    status: "approved",
    totals: { total: 275, currency_code: "USD" },
  });
  assert.equal(transactionEntitlement(tx, expected).points, 75);
  tx.adjustments[0].status = "pending_approval";
  assert.equal(transactionEntitlement(tx, expected).hold, true);
  tx.adjustments[0].status = "approved";
  tx.adjustments[0].action = "chargeback";
  assert.equal(transactionEntitlement(tx, expected).points, 0);
  assert.equal(transactionEntitlement(tx, expected).hold, true);
});
test("paid scenes reserve and settle purchased points once without touching free allowance", () => {
  const { db } = database();
  insertOrder(db);
  db.exec(
    "UPDATE payment_orders SET granted_points=100,revision=1 WHERE id='order-one'",
  );
  db.exec(
    "INSERT INTO credit_accounts VALUES('dev-creator','2026-09-06',3,0,0); INSERT INTO budget_periods VALUES('day','2026-09-06',3000,0,0),('month','2026-09',10000,0,0)",
  );
  const draft = (id: string) =>
    db
      .prepare(
        "INSERT INTO tasks(id,story_id,user_id,prompt_original,base_version,idempotency_key,plan_json,approved_plan_json,created_at,updated_at,generation_mode,provider_model,quoted_points,quoted_reserve_cents) VALUES(?,'last-light','dev-creator','An original idea.',3,?,'{}','{}',1,1,'reference','minimax/h3-max/reference-to-video',20,300)",
      )
      .run(id, id);
  const accept = (id: string) =>
    db
      .prepare(
        "UPDATE tasks SET status='Queued',quota_period='2026-09-06',budget_day='2026-09-06',budget_month='2026-09',reserved_cents=300,policy_version='paid-reference-v1',updated_at=2 WHERE id=?",
      )
      .run(id);
  draft("canceled");
  accept("canceled");
  assert.deepEqual(wallet(db), { balance: 100, reserved: 20, spent: 0 });
  db.exec(
    "UPDATE tasks SET status='Cancelled',updated_at=3 WHERE id='canceled'",
  );
  assert.deepEqual(wallet(db), { balance: 100, reserved: 0, spent: 0 });
  draft("scene");
  accept("scene");
  assert.throws(
    () => db.exec("UPDATE tasks SET quoted_points=1 WHERE id='scene'"),
    /immutable/,
  );
  db.exec(
    "UPDATE tasks SET plan_json=json_object('title','A caller','englishPrompt','A caller knocks at the door.') WHERE id='scene'; UPDATE stories SET active_task_id='scene' WHERE id='last-light'; UPDATE tasks SET status='NeedsModeration',media_ready=1,media_key='test.mp4',media_duration_ms=10000,reviewer_id='dev-studio',approved_summary='Mara listens to a knock.',updated_at=4 WHERE id='scene'; UPDATE tasks SET status='Published',updated_at=5 WHERE id='scene'; UPDATE tasks SET status='Published' WHERE id='scene'",
  );
  assert.deepEqual(wallet(db), { balance: 80, reserved: 0, spent: 20 });
  assert.equal(db.prepare("SELECT spent FROM credit_accounts").get()!.spent, 0);
  db.exec(
    "UPDATE payment_orders SET granted_points=0,revision=2 WHERE id='order-one'",
  );
  assert.deepEqual(wallet(db), { balance: -20, reserved: 0, spent: 20 });
  draft("debt");
  assert.throws(() => accept("debt"), /paid_credits_unavailable/);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM paid_credit_ledger").get()!.n,
    2,
  );
  db.close();
});
test("signed duplicate/out-of-order events reconcile current Paddle state and grant once, even with purchases disabled", async (t) => {
  const { db, env } = database();
  insertOrder(db);
  let tx = clone(transaction),
    reads = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    assert.ok(
      String(url).startsWith(
        `https://sandbox-api.paddle.com/transactions/${transactionId}`,
      ),
    );
    reads++;
    return Response.json(wire(tx));
  });
  const raw = JSON.stringify({
    event_id: `evt_${"d".repeat(26)}`,
    event_type: "transaction.completed",
    occurred_at: new Date().toISOString(),
    data: { id: transactionId, email: "not-stored@example.invalid" },
  });
  const ts = Math.floor(Date.now() / 1000),
    signature = createHmac("sha256", env.PADDLE_WEBHOOK_SECRET!)
      .update(`${ts}:${raw}`)
      .digest("hex");
  const request = () =>
    new Request("https://local.invalid/api/billing/webhook", {
      method: "POST",
      headers: { "Paddle-Signature": `ts=${ts};h1=${signature}` },
      body: raw,
    });
  await receivePaddleWebhook(env, request());
  await receivePaddleWebhook(env, request());
  assert.equal(db.prepare("SELECT count(*) n FROM payment_events").get()!.n, 1);
  const disabled = {
    ...env,
    PAYMENTS_ENABLED: "false",
  } as unknown as Cloudflare.Env;
  await reconcilePayments(disabled);
  await syncPaymentOrder(disabled, expected.id);
  assert.deepEqual(wallet(db), { balance: 100, reserved: 0, spent: 0 });
  assert.equal(
    db.prepare("SELECT count(*) n FROM paid_credit_ledger").get()!.n,
    1,
  );
  tx.adjustments.push({
    id: `adj_${"e".repeat(26)}`,
    transaction_id: transactionId,
    action: "refund",
    status: "approved",
    totals: { total: 1100, currency_code: "USD" },
  });
  await syncPaymentOrder(disabled, expected.id);
  await receivePaddleWebhook(disabled, request());
  await syncPaymentOrder(disabled, expected.id);
  assert.equal(wallet(db).balance, 0);
  assert.equal(
    db.prepare("SELECT count(*) n FROM paid_credit_ledger").get()!.n,
    2,
  );
  assert.ok(reads > 0);
  db.close();
});
test("checkout is authenticated and never repeats an uncertain create", async (t) => {
  const { db, env } = database();
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set(
      "user",
      c.req.header("x-test-user")
        ? {
            id: c.req.header("x-test-user")!,
            displayName: "Test",
            role: "user",
            policyAccepted: true,
          }
        : null,
    );
    await next();
  });
  app.onError((error, c) => {
    const safe = normalizeError(error);
    return c.json({ error: safe.code }, safe.status);
  });
  app.route("/billing", billing);
  const request = (path: string, body: unknown, user = "dev-creator") =>
    app.request(
      `https://test.invalid/billing${path}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(user ? { "x-test-user": user } : {}),
        },
        body: JSON.stringify(body),
      },
      env,
    );
  let posts = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, init: RequestInit) => {
      if (init.method === "POST") posts++;
      throw new Error("Response lost after provider creation");
    },
  );
  const input = {
    packageId: "starter",
    idempotencyKey: crypto.randomUUID(),
    termsVersion: policies.version,
    purchaseAccepted: true,
  };
  assert.equal((await request("/checkout", input, "")).status, 401);
  assert.equal((await request("/checkout", input)).status, 409);
  assert.equal((await request("/checkout", input)).status, 409);
  assert.equal(posts, 1);
  const order = db.prepare("SELECT id,status FROM payment_orders").get()!;
  assert.equal(order.status, "review");
  assert.equal(
    (await request(`/orders/${order.id}/sync`, {}, "dev-studio")).status,
    404,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM paid_credit_accounts").get()!.n,
    0,
  );
  assert.equal(
    checkoutConfigured({
      ...env,
      PADDLE_ENVIRONMENT: "production",
      PADDLE_API_KEY: "pdl_live_fake",
      PADDLE_CLIENT_TOKEN: "live_fake",
    }),
    false,
  );
  db.close();
});
test("a successful checkout resumes the same transaction and payment help stays private", async (t) => {
  const { db, env } = database();
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    const id = c.req.header("x-test-user") ?? "dev-creator";
    c.set("user", {
      id,
      displayName: "Test",
      role: id === "dev-studio" ? "admin" : "user",
      policyAccepted: true,
    });
    await next();
  });
  app.onError((error, c) => {
    const safe = normalizeError(error);
    return c.json({ error: safe.code }, safe.status);
  });
  app.route("/billing", billing);
  const call = (path: string, body: unknown, user = "dev-creator") =>
    app.request(
      `https://test.invalid/billing${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-user": user },
        body: JSON.stringify(body),
      },
      env,
    );
  let creates = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, init: RequestInit) => {
      assert.equal(init.method, "POST");
      creates++;
      return Response.json({ data: { id: transactionId } });
    },
  );
  const input = {
    packageId: "starter",
    idempotencyKey: crypto.randomUUID(),
    termsVersion: policies.version,
    purchaseAccepted: true,
  };
  const first = await call("/checkout", input);
  assert.equal(first.status, 200);
  const session = (await first.json()) as {
    orderId: string;
    transactionId: string;
  };
  assert.equal((await call("/checkout", input)).status, 200);
  const resumed = await call(`/orders/${session.orderId}/checkout`, {});
  assert.equal(resumed.status, 200);
  assert.equal(
    ((await resumed.json()) as any).transactionId,
    session.transactionId,
  );
  assert.equal(creates, 1);
  assert.equal(
    (await call(`/orders/${session.orderId}/checkout`, {}, "dev-studio"))
      .status,
    404,
  );
  assert.equal(
    (
      await call(`/orders/${session.orderId}/help`, {
        reason: "Please check my payment status.",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(`/orders/${session.orderId}/help`, {
        reason: "Please check my payment status.",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        `/orders/${session.orderId}/help`,
        { reason: "Please check my payment status." },
        "dev-studio",
      )
    ).status,
    404,
  );
  assert.equal(
    db.prepare("SELECT count(*) n FROM billing_requests").get()!.n,
    1,
  );
  const req = db.prepare("SELECT id FROM billing_requests").get()!.id;
  assert.equal(
    (
      await call(`/admin/requests/${req}/respond`, {
        response: "Your payment is still pending.",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        `/admin/requests/${req}/respond`,
        { response: "Your payment is still pending." },
        "dev-studio",
      )
    ).status,
    200,
  );
  assert.equal(
    db.prepare("SELECT count(*) n FROM paid_credit_accounts").get()!.n,
    0,
  );
  db.close();
});
