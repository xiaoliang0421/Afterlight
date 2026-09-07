import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { unstable_splitSqlQuery } from "wrangler";
import { Hono } from "hono";
import { ZodError } from "zod";
import {
  accountDeletion,
  cleanupDeletedAccountMedia,
} from "../worker/account-deletion";
import { normalizeError } from "../worker/errors";
import type { AppEnv } from "../worker/auth";
import policies from "../shared/policies.json";

function setup() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").sort())
    for (const sql of unstable_splitSqlQuery(
      readFileSync(`migrations/${file}`, "utf8"),
    ))
      db.exec(sql);
  db.exec(readFileSync("fixtures/seed.sql", "utf8"));
  db.exec(`INSERT INTO account_requests(id,user_id,kind,reason,created_at) VALUES('delete-me','dev-creator','deletion','Private reason',1);
    INSERT INTO tasks(id,story_id,user_id,prompt_original,base_version,idempotency_key,created_at,updated_at) VALUES('private-draft','last-light','dev-creator','Private prompt',3,'private-key',1,1);
    INSERT INTO "user" VALUES('dev-creator','Private Name','creator@example.invalid',1,NULL,1,1);
    INSERT INTO "session" VALUES('auth-session',9999999999999,'fake-token',1,1,'192.0.2.1','test','dev-creator');
    INSERT INTO "account"(id,accountId,providerId,userId,accessToken,createdAt,updatedAt) VALUES('auth-account','google-test','google','dev-creator','fake-oauth',1,1);
    INSERT INTO sessions VALUES('fake-hash','dev-creator',9999999999999,1);
    INSERT INTO favorites VALUES('dev-creator','last-light');
    UPDATE scenes SET author_id='dev-creator' WHERE id='sample-light-1';`);
  const deleted: string[] = [];
  const wrapper = {
    prepare(sql: string) {
      let values: any[] = [];
      const s = {
        bind(...v: any[]) {
          values = v;
          return s;
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
      return s;
    },
    async batch(statements: { run: () => Promise<unknown> }[]) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        db.exec("COMMIT");
        return results;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
  const env = {
    DB: wrapper,
    ENVIRONMENT: "development",
    ALLOW_DEV_LOGIN: "true",
    MEDIA: {
      async delete(key: string) {
        deleted.push(key);
      },
    },
  } as unknown as Cloudflare.Env;
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    const actor = c.req.header("X-Test-Actor") ?? "dev-studio";
    c.set(
      "user",
      actor === "none"
        ? null
        : {
            id: actor,
            email: "test@example.invalid",
            displayName: "Test",
            role: actor === "dev-studio" ? "admin" : "user",
            policyAccepted: true,
          },
    );
    await next();
  });
  app.onError((e, c) => {
    if (e instanceof ZodError)
      return c.json({ error: { code: "invalid_input" } }, 400);
    const err = normalizeError(e);
    return c.json(
      { error: { code: err.code, message: err.message } },
      err.status as 400,
    );
  });
  app.route("/requests", accountDeletion);
  const execute = (
    overrides: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ) =>
    app.request(
      "/requests/delete-me/execute",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          userId: "dev-creator",
          policyVersion: policies.version,
          reviewedContent: true,
          confirm: "DELETE ACCOUNT",
          ...overrides,
        }),
      },
      env,
    );
  return { db, env, app, execute, deleted };
}

test("deletion erases sign-in and private inputs, retains shared playback and is idempotent", async () => {
  const { db, execute } = setup();
  assert.equal((await execute()).status, 200);
  assert.deepEqual(
    {
      ...db
        .prepare("SELECT email,display_name,nickname_key FROM users WHERE id=?")
        .get("dev-creator"),
    },
    { email: null, display_name: "Deleted storyteller", nickname_key: "" },
  );
  for (const table of ["user", "session", "account", "sessions", "favorites"])
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get()!.n,
      0,
    );
  assert.equal(
    db.prepare("SELECT status FROM tasks WHERE id=?").get("private-draft")!
      .status,
    "Cancelled",
  );
  assert.equal(
    db
      .prepare("SELECT prompt_original FROM tasks WHERE id=?")
      .get("private-draft")!.prompt_original,
    "",
  );
  assert.equal(
    db.prepare("SELECT media_key FROM scenes WHERE id=?").get("sample-light-1")!
      .media_key,
    "fixture:sample",
  );
  assert.equal(
    db
      .prepare("SELECT prompt_original FROM scenes WHERE id=?")
      .get("sample-light-1")!.prompt_original,
    "Removed at the author's request.",
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM scenes").get()!.n, 4);
  assert.equal(
    ((await (await execute()).json()) as any).alreadyCompleted,
    true,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_log WHERE action='account.deleted'",
      )
      .get()!.n,
    1,
  );
  db.close();
});

test("deletion requires an administrator, exact target, explicit review and final hosted policies", async () => {
  const { db, env, execute } = setup();
  assert.equal((await execute({}, { "X-Test-Actor": "none" })).status, 401);
  assert.equal(
    (await execute({}, { "X-Test-Actor": "dev-creator" })).status,
    403,
  );
  assert.equal((await execute({ userId: "dev-studio" })).status, 409);
  assert.equal((await execute({ reviewedContent: false })).status, 400);
  assert.equal((await execute({ policyVersion: "obsolete" })).status, 409);
  (env as any).ENVIRONMENT = "staging";
  assert.equal((await execute()).status, 409);
  assert.equal(
    db.prepare("SELECT deleted_at FROM users WHERE id=?").get("dev-creator")!
      .deleted_at,
    null,
  );
  db.close();
});

test("active previews, reservations, billing balances and withdrawn requests block deletion without partial changes", async () => {
  for (const change of [
    "UPDATE tasks SET preview_lock='busy' WHERE id='private-draft'",
    "UPDATE tasks SET status='ReconciliationNeeded' WHERE id='private-draft'",
    "INSERT INTO paid_credit_accounts VALUES('dev-creator',100,0,0)",
    "UPDATE account_requests SET status='cancelled' WHERE id='delete-me'",
  ]) {
    const { db, execute } = setup();
    db.exec(change);
    assert.equal((await execute()).status, 409);
    assert.equal(
      db.prepare("SELECT email FROM users WHERE id=?").get("dev-creator")!
        .email,
      "creator@example.invalid",
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM account_deletions").get()!.n,
      0,
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM "account"').get()!.n, 1);
    db.close();
  }
});

test("database rechecks concurrent changes and cannot erase active request evidence", async () => {
  const { db, env, execute } = setup();
  const batch = env.DB.batch.bind(env.DB);
  env.DB.batch = (async (statements: any) => {
    db.exec("UPDATE tasks SET preview_lock='raced' WHERE id='private-draft'");
    return batch(statements);
  }) as typeof env.DB.batch;
  assert.equal((await execute()).status, 409);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM account_deletions").get()!.n,
    0,
  );
  assert.equal(
    db.prepare("SELECT deleted_at FROM users WHERE id=?").get("dev-creator")!
      .deleted_at,
    null,
  );
  assert.equal(
    db
      .prepare("SELECT prompt_original FROM tasks WHERE id=?")
      .get("private-draft")!.prompt_original,
    "Private prompt",
  );
  db.close();
});

test("private task media deletion is durable and never deletes published media", async () => {
  const { db, env, execute, deleted } = setup();
  const key = "stories/last-light/tasks/private-draft/original.mp4";
  db.prepare("UPDATE tasks SET media_key=? WHERE id=?").run(
    key,
    "private-draft",
  );
  assert.equal((await execute()).status, 200);
  env.MEDIA.delete = async () => {
    throw new Error("temporary R2 failure");
  };
  await assert.rejects(cleanupDeletedAccountMedia(env));
  assert.equal(
    db
      .prepare(
        "SELECT completed_at FROM privacy_media_cleanup WHERE object_key=?",
      )
      .get(key)!.completed_at,
    null,
  );
  env.MEDIA.delete = async (k: any) => {
    deleted.push(k);
  };
  await cleanupDeletedAccountMedia(env);
  await cleanupDeletedAccountMedia(env);
  assert.deepEqual(deleted, [key]);
  db.close();
});

test("deleted accounts cannot be revived by an in-flight request, and attempt IDs remain immutable", async () => {
  const { db, execute } = setup();
  db.exec(
    "UPDATE tasks SET status='Failed',provider_attempt_id='immutable-attempt',provider_request_id='immutable-request',provider_submitted_at=1,provider_input_json='{}' WHERE id='private-draft'",
  );
  assert.throws(
    () =>
      db.exec(
        "UPDATE tasks SET provider_input_json=NULL WHERE id='private-draft'",
      ),
    /provider_attempt_immutable/,
  );
  assert.equal((await execute()).status, 200);
  const attempt = db
    .prepare(
      "SELECT provider_attempt_id,provider_request_id,provider_input_json FROM tasks WHERE id='private-draft'",
    )
    .get()!;
  assert.equal(attempt.provider_attempt_id, "immutable-attempt");
  assert.equal(attempt.provider_request_id, "immutable-request");
  assert.equal(attempt.provider_input_json, null);
  for (const sql of [
    "UPDATE users SET deleted_at=NULL WHERE id='dev-creator'",
    "UPDATE users SET display_name='Revived' WHERE id='dev-creator'",
    "INSERT INTO favorites VALUES('dev-creator','last-light')",
    "INSERT INTO sessions VALUES('late-login','dev-creator',9999999999999,1)",
    "INSERT INTO tasks(id,story_id,user_id,prompt_original,base_version,idempotency_key,created_at,updated_at) VALUES('late-task','last-light','dev-creator','late prompt',3,'late-key',1,1)",
    "UPDATE tasks SET status='Draft',prompt_original='late draft' WHERE id='private-draft'",
  ])
    assert.throws(() => db.exec(sql), /account_deleted/);
  assert.throws(
    () =>
      db.exec(
        "UPDATE tasks SET provider_request_id='replacement' WHERE id='private-draft'",
      ),
    /provider_attempt_immutable/,
  );
  db.close();
});
