import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { unstable_splitSqlQuery } from "wrangler";
import {
  matchesSubmitted,
  verifyRecoveredRequest,
  requireStoppedWorkflow,
  scheduleRecovery,
} from "../worker/recovery";
import { getTask } from "../worker/store";
import { Hono } from "hono";
import { admin } from "../worker/admin";
import { normalizeError } from "../worker/errors";
import type { AppEnv } from "../worker/auth";
import { operationHealth, recordedReconciliation } from "../worker/operations";
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
  return { db, env: { DB: wrapper } as unknown as Cloudflare.Env };
}

const requestId = "01a075e6-083e-7272-bcf6-bcf6a4e3630b";
const model = "minimax/h3-max-turbo/text-to-video";
const input = {
  prompt: "Mara opens the door.",
  duration: 10,
  reference_image_urls: [],
};
function attempt(db: DatabaseSync, id = "recover") {
  db.prepare(
    "INSERT INTO tasks(id,story_id,user_id,prompt_original,base_version,idempotency_key,created_at,updated_at,status,provider_attempt_id,provider_input_json,provider_submitted_at,provider_model,workflow_id) VALUES(?,'last-light','dev-creator','Mara opens the door.',3,?,1,1,'ReconciliationNeeded',?,?,?,?,'old-workflow')",
  ).run(id, id, `attempt-${id}`, JSON.stringify(input), Date.now(), model);
}
test("recovery matches every submitted field without relying on JSON key order", () => {
  assert.equal(
    matchesSubmitted(input, {
      duration: 10,
      prompt: input.prompt,
      reference_image_urls: [],
      provider_default: true,
    }),
    true,
  );
  for (const other of [
    { ...input, prompt: "Another story" },
    { ...input, duration: 6 },
    { ...input, reference_image_urls: ["https://other.invalid"] },
    { prompt: input.prompt, duration: 10 },
  ])
    assert.equal(matchesSubmitted(input, other), false);
});
test("a lost fal response can be verified with GETs only; wrong time/model/input/request and reused IDs are rejected", async (t) => {
  const { db, env } = database();
  attempt(db);
  env.FAL_KEY = "test-not-a-real-key";
  const task = await getTask(env, "recover");
  let item = {
    request_id: requestId,
    endpoint_id: model,
    sent_at: new Date(task.provider_submitted_at!).toISOString(),
    status_code: 200,
    json_input: input,
  };
  const good = structuredClone(item);
  const methods: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      assert.equal(init?.redirect, "manual");
      if (
        String(url).startsWith(
          "https://api.fal.ai/v1/models/requests/by-endpoint?",
        )
      )
        return Response.json({ items: [item] });
      assert.equal(
        String(url),
        `https://queue.fal.run/minimax/h3-max-turbo/requests/${requestId}/status`,
      );
      return Response.json({ request_id: requestId, status: "COMPLETED" });
    },
  );
  assert.equal(
    (await verifyRecoveredRequest(env, task, requestId)).status,
    "COMPLETED",
  );
  for (const patch of [
    { endpoint_id: "minimax/h3-max/reference-to-video" },
    { sent_at: "2020-01-01T00:00:00Z" },
    { json_input: { ...input, prompt: "Different task" } },
    { request_id: crypto.randomUUID() },
  ]) {
    item = { ...good, ...patch };
    await assert.rejects(
      () => verifyRecoveredRequest(env, task, requestId),
      /could not all be matched/,
    );
  }
  item = good;
  attempt(db, "other");
  db.prepare("UPDATE tasks SET provider_request_id=? WHERE id='other'").run(
    requestId,
  );
  await assert.rejects(
    () => verifyRecoveredRequest(env, task, requestId),
    /another task/,
  );
  assert.deepEqual(new Set(methods), new Set(["GET"]));
  await assert.rejects(
    () =>
      verifyRecoveredRequest(
        env,
        { ...task, provider_input_json: null },
        requestId,
      ),
    /no saved input/,
  );
  assert.throws(
    () =>
      db.exec("UPDATE tasks SET provider_attempt_id=NULL WHERE id='recover'"),
    /provider_attempt_immutable/,
  );
  assert.throws(
    () =>
      db.exec("UPDATE tasks SET provider_input_json='{}' WHERE id='recover'"),
    /provider_attempt_immutable/,
  );
  db.close();
});
test("recovery refuses an active or unavailable workflow and persists exactly one dispatch under competing operators", async () => {
  const { db, env } = database();
  attempt(db);
  db.prepare(
    "UPDATE tasks SET provider_request_id=?,provider_status_url=?,provider_result_url=? WHERE id='recover'",
  ).run(
    requestId,
    "https://queue.fal.run/status",
    "https://queue.fal.run/result",
  );
  const task = await getTask(env, "recover");
  let state = "running";
  env.GENERATION = {
    get: async () => ({ status: async () => ({ status: state }) }),
    create: async () => {
      throw new Error("dispatch temporarily unavailable");
    },
  } as unknown as Cloudflare.Env["GENERATION"];
  await assert.rejects(
    () => requireStoppedWorkflow(env, task),
    /not been confirmed stopped/,
  );
  state = "complete";
  await requireStoppedWorkflow(env, task);
  const attempts = await Promise.allSettled([
    scheduleRecovery(env, task, "Verified with provider."),
    scheduleRecovery(env, task, "Concurrent operator."),
  ]);
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
  const persisted = await getTask(env, "recover");
  assert.equal(persisted.status, "Generating");
  assert.ok(persisted.workflow_id?.startsWith("recovery-"));
  assert.equal(persisted.provider_request_id, requestId);
  assert.equal(persisted.provider_attempt_id, task.provider_attempt_id);
  db.close();
});
test("Studio recovery requires an admin, previews before linking, and survives failed dispatch without resubmitting", async (t) => {
  const { db, env } = database();
  attempt(db);
  const task = await getTask(env, "recover");
  env.FAL_KEY = "test-only";
  let posts = 0;
  env.GENERATION = {
    get: async () => ({ status: async () => ({ status: "complete" }) }),
  } as unknown as Cloudflare.Env["GENERATION"];
  env.STORY_ROOMS = {
    getByName: () => ({
      kick: async () => {
        throw new Error("dispatcher unavailable");
      },
    }),
  } as unknown as Cloudflare.Env["STORY_ROOMS"];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL, init?: RequestInit) => {
      if (init?.method === "POST") posts++;
      return String(url).includes("by-endpoint")
        ? Response.json({
            items: [
              {
                request_id: requestId,
                endpoint_id: model,
                sent_at: new Date(task.provider_submitted_at!).toISOString(),
                status_code: 200,
                json_input: input,
              },
            ],
          })
        : Response.json({ request_id: requestId, status: "COMPLETED" });
    },
  );
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("user", {
      id: "dev-studio",
      displayName: "Studio",
      role: c.req.header("X-Test-Admin") ? "admin" : "user",
      policyAccepted: true,
    });
    await next();
  });
  app.onError((e, c) => {
    const safe = normalizeError(e);
    return c.json({ error: safe.code }, safe.status);
  });
  app.route("/admin", admin);
  const deferred: Promise<unknown>[] = [];
  const call = (path: string, data: unknown, asAdmin = true) =>
    app.request(
      `https://test.invalid/admin/tasks/recover/${path}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(asAdmin ? { "X-Test-Admin": "1" } : {}),
        },
        body: JSON.stringify(data),
      },
      env,
      {
        waitUntil: (p: Promise<unknown>) => deferred.push(p),
        passThroughOnException: () => {},
      } as unknown as ExecutionContext,
    );
  const data = {
    requestId,
    reason: "Verified the matching request in the provider dashboard.",
    confirm: false,
  };
  assert.equal((await call("recovery", data, false)).status, 403);
  const preview = await call("recovery", data);
  assert.equal(preview.status, 200);
  assert.equal(
    JSON.stringify(await preview.json()).includes(input.prompt),
    false,
  );
  assert.equal((await getTask(env, "recover")).provider_request_id, null);
  assert.equal(
    (await call("recovery", { ...data, confirm: true })).status,
    200,
  );
  assert.equal((await getTask(env, "recover")).status, "ReconciliationNeeded");
  assert.equal(
    (await call("recovery", { ...data, confirm: true })).status,
    409,
  );
  const resolve = { action: "resume-known-request", reason: data.reason };
  assert.equal((await call("resolve", resolve)).status, 200);
  await Promise.all(deferred);
  assert.equal((await getTask(env, "recover")).status, "Generating");
  assert.equal((await call("resolve", resolve)).status, 409);
  assert.equal(posts, 0);
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE target_id='recover'")
      .get()!.n,
    2,
  );
  db.close();
});
test("scheduled diagnostics preserve the last completion when a later run fails", async () => {
  const { db, env } = database();
  assert.equal((await operationHealth(env)).overdue, true);
  await recordedReconciliation(env, async () => {});
  const first = (await operationHealth(env)).runtime!.completedAt;
  assert.ok(first > 0);
  assert.equal((await operationHealth(env)).overdue, false);
  await assert.rejects(() =>
    recordedReconciliation(env, async () => {
      throw new Error("Simulated failure");
    }),
  );
  const last = (await operationHealth(env)).runtime!;
  assert.equal(last.completedAt, first);
  assert.ok(last.failureAt >= first);
  db.close();
});
