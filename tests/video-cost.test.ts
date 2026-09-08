import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { admin } from "../worker/admin";
import type { AppEnv } from "../worker/auth";
import { normalizeError } from "../worker/errors";
import { reconcileVideoCost, videoCostInput } from "../worker/video-cost";
import { adaptD1, migrateFixture } from "./support/database";

const input = {
  providerRequestId: "test-video-request",
  recordedCostCents: 12,
  evidence: "Provider billing record: final video charge USD 0.12.",
  reviewed: true as const,
};
function setup() {
  const db = new DatabaseSync(":memory:");
  migrateFixture(db);
  db.exec(`UPDATE stories SET fixture=0 WHERE id='last-light';
    INSERT INTO credit_accounts VALUES('dev-creator','2026-09-06',3,0,0);
    INSERT INTO budget_periods VALUES('day','2026-09-06',3000,0,0),('month','2026-09',10000,0,0);
    INSERT INTO tasks(billing_kind,id,story_id,user_id,prompt_original,base_version,idempotency_key,plan_json,approved_plan_json,created_at,updated_at)
      VALUES('legacy-free','cost-test','last-light','dev-creator','Test idea',3,'cost-test','{}','{}',1,1);
    UPDATE tasks SET status='Queued',quota_period='2026-09-06',budget_day='2026-09-06',budget_month='2026-09',reserved_cents=50,updated_at=2 WHERE id='cost-test';
    UPDATE tasks SET status='NeedsModeration',provider_request_id='test-video-request',media_key='test.mp4',media_ready=1,media_duration_ms=10000,recorded_cost_cents=50,cost_status='estimated-ceiling' WHERE id='cost-test';`);
  const env = { DB: adaptD1(db) } as Cloudflare.Env;
  const task = () =>
    db
      .prepare(
        "SELECT status,recorded_cost_cents,cost_status,reservation_active FROM tasks WHERE id='cost-test'",
      )
      .get()!;
  const money = () =>
    JSON.stringify({
      budgets: db.prepare("SELECT * FROM budget_periods").all(),
      wallet: db.prepare("SELECT * FROM provider_wallet").all(),
      credits: db.prepare("SELECT * FROM credit_accounts").all(),
      ledger: db.prepare("SELECT * FROM ledger").all(),
    });
  const receipts = () =>
    db
      .prepare("SELECT * FROM audit_log WHERE action='video.cost-reconciled'")
      .all();
  const reconcile = (value = input) =>
    reconcileVideoCost(env, "cost-test", "dev-studio", value);
  return { db, env, task, money, receipts, reconcile };
}
test("verified cost preserves the reservation and rejection settles actual cost exactly once", async (t) => {
  const s = setup();
  t.after(() => s.db.close());
  const before = s.money();
  await s.reconcile();
  assert.equal(s.task().recorded_cost_cents, 12);
  assert.equal(s.task().cost_status, "reconciled");
  assert.equal(s.task().status, "NeedsModeration");
  assert.equal(s.money(), before);
  await s.reconcile();
  assert.equal(s.receipts().length, 1);
  const detail = JSON.parse(s.receipts()[0].detail as string);
  assert.equal(detail.previousCostCents, 50);
  assert.equal(detail.providerRequestId, input.providerRequestId);
  assert.equal(s.receipts()[0].actor_id, "dev-studio");
  s.db.exec(
    "UPDATE tasks SET status='Failed',updated_at=3 WHERE id='cost-test'",
  );
  const settled = s.money();
  await s.reconcile(); // Retry after a lost response and subsequent moderation.
  assert.equal(s.money(), settled);
  assert.equal(s.task().reservation_active, 0);
  assert.equal(
    s.db.prepare("SELECT cents FROM ledger WHERE kind='release'").get()!.cents,
    12,
  );
  assert.equal(
    s.db
      .prepare("SELECT spent_cents FROM budget_periods WHERE kind='day'")
      .get()!.spent_cents,
    12,
  );
  assert.equal(
    s.db.prepare("SELECT reserved,spent FROM credit_accounts").get()!.reserved,
    0,
  );
  assert.equal(
    s.db.prepare("SELECT reserved,spent FROM credit_accounts").get()!.spent,
    0,
  );
  await assert.rejects(
    s.reconcile({ ...input, recordedCostCents: 13 }),
    /different cost/,
  );
  assert.equal(s.money(), settled);
});
test("stale, mismatched, fixture and unreserved tasks cannot change costs or money", async () => {
  for (const sql of [
    "UPDATE tasks SET status='ReconciliationNeeded'",
    "UPDATE tasks SET media_ready=0",
    "UPDATE tasks SET media_key='fixture:video'",
    "UPDATE tasks SET reservation_active=0",
    "UPDATE tasks SET cost_status='reconciled'",
    "UPDATE stories SET fixture=1",
  ]) {
    const s = setup();
    try {
      s.db.exec(sql);
      const before = s.money();
      const task = s.task();
      await assert.rejects(s.reconcile(), /Only a completed real video/);
      assert.deepEqual(s.task(), task);
      assert.equal(s.money(), before);
      assert.equal(s.receipts().length, 0);
    } finally {
      s.db.close();
    }
  }
});
test("overruns stay held; invalid or unreviewed amounts cannot enter the route", async (t) => {
  const s = setup();
  t.after(() => s.db.close());
  const before = s.money();
  await assert.rejects(
    s.reconcile({ ...input, providerRequestId: "different" }),
    /Only a completed real video/,
  );
  await assert.rejects(
    s.reconcile({ ...input, recordedCostCents: 51 }),
    /exceeds this reservation/,
  );
  assert.equal(s.money(), before);
  assert.equal(s.receipts().length, 0);
  for (const patch of [
    { recordedCostCents: -1 },
    { recordedCostCents: 0.1 },
    { recordedCostCents: Number.MAX_SAFE_INTEGER + 1 },
    { reviewed: false },
    { evidence: "" },
  ])
    assert.equal(
      videoCostInput.safeParse({ ...input, ...patch }).success,
      false,
    );
  await s.reconcile({ ...input, recordedCostCents: 0 });
  assert.equal(s.task().recorded_cost_cents, 0);
});
test("two competing cost reviews preserve the winning receipt and reject a conflicting amount", async (t) => {
  const s = setup();
  t.after(() => s.db.close());
  const batch = s.env.DB.batch.bind(s.env.DB);
  s.env.DB.batch = async (statements: any) => {
    s.env.DB.batch = batch;
    await s.reconcile({ ...input, recordedCostCents: 11 });
    return batch(statements);
  };
  const before = s.money();
  await assert.rejects(s.reconcile(), /different cost/);
  assert.equal(s.task().recorded_cost_cents, 11);
  assert.equal(s.receipts().length, 1);
  assert.equal(s.money(), before);
});
test("moderation winning the race prevents both the cost update and its receipt", async (t) => {
  const s = setup();
  t.after(() => s.db.close());
  const batch = s.env.DB.batch.bind(s.env.DB);
  s.env.DB.batch = async (statements: any) => {
    s.db.exec(
      "UPDATE tasks SET status='Failed',updated_at=3 WHERE id='cost-test'",
    );
    return batch(statements);
  };
  await assert.rejects(s.reconcile(), /Only a completed real video/);
  assert.equal(s.receipts().length, 0);
  assert.equal(s.task().recorded_cost_cents, 50);
  assert.equal(
    s.db.prepare("SELECT cents FROM ledger WHERE kind='release'").get()!.cents,
    50,
  );
});
test("failed cost updates roll back receipts, and failed receipts cannot change costs", async () => {
  for (const trigger of [
    "CREATE TRIGGER fail_receipt BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'storage failed'); END",
    "CREATE TRIGGER fail_cost BEFORE UPDATE OF cost_status ON tasks BEGIN SELECT RAISE(ABORT,'storage failed'); END",
  ]) {
    const s = setup();
    try {
      s.db.exec(trigger);
      const before = s.money();
      await assert.rejects(s.reconcile(), /storage failed/);
      assert.equal(s.task().recorded_cost_cents, 50);
      assert.equal(s.task().cost_status, "estimated-ceiling");
      assert.equal(s.receipts().length, 0);
      assert.equal(s.money(), before);
    } finally {
      s.db.close();
    }
  }
});
test("only Studio administrators can record a completed video cost", async (t) => {
  const s = setup();
  t.after(() => s.db.close());
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("user", {
      id: "dev-creator",
      role: "user",
      displayName: "Test",
      email: "test@example.invalid",
      policyAccepted: true,
    });
    await next();
  });
  app.onError((error, c) => {
    const e = normalizeError(error);
    return c.json({ error: e.code }, e.status);
  });
  app.route("/api/admin", admin);
  const before = s.money();
  const result = await app.request(
    "/api/admin/tasks/cost-test/cost",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    s.env,
  );
  assert.equal(result.status, 403);
  assert.equal(s.receipts().length, 0);
  assert.equal(s.money(), before);
});
