import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { adaptD1, migrateFixture } from "./support/database";
import { reconcile } from "../worker/reconciliation";
import {
  operationHealth,
  recordedReconciliation,
  runReconciliationSteps,
} from "../worker/operations";

test("failed balance and queue checks remain visible while other queues and outbox recover", async (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  migrateFixture(db);
  const env = {
    DB: adaptD1(db),
    PROVIDER_MODE: "disabled",
    ENVIRONMENT: "staging",
  } as unknown as Cloudflare.Env;
  const queueCalls: string[] = [];
  let unavailable = false;
  env.STORY_ROOMS = {
    getByName: (id: string) => ({
      kick: async () => {
        queueCalls.push(id);
        if (unavailable && id === "last-light")
          throw new Error("Synthetic outage");
      },
      broadcast: async () => {
        if (unavailable && id === "last-light")
          throw new Error("Synthetic outage");
      },
    }),
  } as unknown as Cloudflare.Env["STORY_ROOMS"];
  const requests: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init?: RequestInit) => {
      requests.push(init?.method ?? "GET");
      return new Response("", { status: 503 });
    },
  );
  await recordedReconciliation(env, (runId) => reconcile(env, runId));
  const priorSuccess = (await operationHealth(env)).runtime!.completedAt;
  db.exec(`UPDATE stories SET active_task_id='synthetic-active-task';
    INSERT INTO outbox VALUES('a','last-light','{}',NULL,1),('b','quiet-orbit','{}',NULL,2);
    INSERT INTO rate_limits VALUES('expired',1,1);`);
  unavailable = true;
  Object.assign(env, {
    PROVIDER_MODE: "live",
    FAL_ADMIN_KEY: "synthetic-test-key",
  });
  await assert.rejects(
    () => recordedReconciliation(env, (runId) => reconcile(env, runId)),
    /provider-balance.*story-queues.*outbox/,
  );
  const failure = await operationHealth(env);
  assert.equal(failure.runtime!.status, "failed");
  assert.equal(failure.runtime!.completedAt, priorSuccess);
  assert.deepEqual(
    failure.components.filter((c) => c.status === "failed").map((c) => c.name),
    ["outbox", "provider-balance", "story-queues"],
  );
  assert.equal(
    failure.components.find((c) => c.name === "payments")!.status,
    "skipped",
  );
  assert.equal(
    failure.components.find((c) => c.name === "housekeeping")!.status,
    "succeeded",
  );
  assert.deepEqual(queueCalls.sort(), ["last-light", "quiet-orbit"]);
  assert.equal(
    db.prepare("SELECT sent_at FROM outbox WHERE id='a'").get()!.sent_at,
    null,
  );
  const delivered = db.prepare("SELECT sent_at FROM outbox WHERE id='b'").get()!
    .sent_at;
  assert.ok(delivered);
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE key='expired'")
      .get()!.n,
    0,
  );
  assert.deepEqual(requests, ["GET"]);
  unavailable = false;
  Object.assign(env, { PROVIDER_MODE: "disabled" });
  await recordedReconciliation(env, (runId) => reconcile(env, runId));
  const recovered = await operationHealth(env);
  assert.equal(recovered.runtime!.status, "succeeded");
  assert.equal(
    recovered.components.filter((c) => c.status === "failed").length,
    0,
  );
  assert.equal(
    recovered.components.find((c) => c.name === "provider-balance")!.status,
    "skipped",
  );
  assert.ok(
    db.prepare("SELECT sent_at FROM outbox WHERE id='a'").get()!.sent_at,
  );
  assert.equal(
    db.prepare("SELECT sent_at FROM outbox WHERE id='b'").get()!.sent_at,
    delivered,
  );
});

test("a failed early component does not skip later cleanup or retain a false success", async (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  migrateFixture(db);
  const env = { DB: adaptD1(db) } as Cloudflare.Env;
  const calls: string[] = [];
  await assert.rejects(() =>
    recordedReconciliation(env, () =>
      runReconciliationSteps(env, [
        {
          name: "payments",
          run: async () => {
            throw new Error("Synthetic failure");
          },
        },
        {
          name: "privacy-media",
          run: async () => {
            calls.push("cleanup");
          },
        },
        {
          name: "story-queues",
          run: async () => {
            calls.push("queues");
          },
        },
      ]),
    ),
  );
  assert.deepEqual(calls, ["cleanup", "queues"]);
  assert.equal((await operationHealth(env)).runtime!.completedAt, 0);
});

test("a late completion from an older pass cannot overwrite a newer failure even in the same millisecond", async (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  migrateFixture(db);
  const env = { DB: adaptD1(db) } as Cloudflare.Env;
  t.mock.method(Date, "now", () => 1_800_000_000_000);
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let staleQueueCalls = 0;
  const first = recordedReconciliation(env, (runId) =>
    runReconciliationSteps(
      env,
      [
        {
          name: "payments",
          run: async () => {
            entered();
            await held;
          },
        },
        {
          name: "story-queues",
          run: async () => {
            staleQueueCalls++;
          },
        },
      ],
      runId,
    ),
  );
  await ready;
  await assert.rejects(() =>
    recordedReconciliation(env, (runId) =>
      runReconciliationSteps(
        env,
        [
          { name: "payments", run: async () => {} },
          {
            name: "story-queues",
            run: async () => {
              throw new Error("Newer failure");
            },
          },
        ],
        runId,
      ),
    ),
  );
  release();
  await first;
  const result = (await operationHealth(env)).runtime!;
  assert.equal(result.status, "failed");
  assert.equal(result.completedAt, 0);
  assert.equal(result.failureAt, Date.now());
  assert.equal(staleQueueCalls, 0);
  assert.equal(
    (await operationHealth(env)).components.find(
      (c) => c.name === "story-queues",
    )!.status,
    "failed",
  );
});
