import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { unstable_splitSqlQuery } from "wrangler";
import { Hono } from "hono";
import { ZodError } from "zod";
import { adaptD1, migrateFixture } from "./support/database";
import { production } from "../worker/production";
import { getTask, acceptTask, getScenes } from "../worker/store";
import { billing, generationOffer } from "../worker/billing";
import { normalizeError } from "../worker/errors";
import type { AppEnv } from "../worker/auth";
import policies from "../shared/policies.json";

function setup() {
  const db = new DatabaseSync(":memory:");
  migrateFixture(db);
  db.exec(readFileSync("fixtures/production.sql", "utf8"));
  const env = {
    DB: adaptD1(db),
    PROVIDER_MODE: "fixture",
    ENVIRONMENT: "development",
    PAYMENTS_ENABLED: "false",
    STORY_ROOMS: {
      getByName: () => ({ kick: async () => {}, broadcast: async () => {} }),
    },
  } as unknown as Cloudflare.Env;
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    const id = c.req.header("X-User") ?? "dev-studio";
    c.set("user", {
      id,
      displayName: id,
      role: id === "dev-studio" ? "admin" : "user",
      policyAccepted: true,
    });
    await next();
  });
  app.route("/api", production);
  app.route("/api/billing", billing);
  app.onError((e, c) => {
    const err = normalizeError(e);
    return c.json(
      { error: err.code },
      e instanceof ZodError ? 400 : err.status,
    );
  });
  const call = (
    path: string,
    body?: unknown,
    user = "dev-studio",
    method = body === undefined ? "GET" : "POST",
  ) =>
    app.request(
      `/api${path}`,
      {
        method,
        headers: { "Content-Type": "application/json", "X-User": user },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
  return { db, env, call };
}
async function proposal(s: ReturnType<typeof setup>) {
  const input = {
    prompt: "Mara finds a second mark on the brass key.",
    idempotencyKey: randomUUID(),
    publicAttributionAccepted: true,
    termsVersion: policies.version,
  };
  const r = await s.call("/stories/last-light/proposals", input, "dev-creator");
  assert.equal(r.status, 201);
  return { id: ((await r.json()) as { id: string }).id, input };
}
function draft(
  s: ReturnType<typeof setup>,
  id: string,
  story = "last-light",
  proposals: string[] = [],
  points = 5,
) {
  s.db
    .prepare(
      `INSERT INTO tasks(id,story_id,user_id,prompt_original,base_version,idempotency_key,created_at,updated_at,plan_json,quoted_points,quoted_reserve_cents,proposal_ids_json,billing_kind)
 VALUES(?,?,'dev-studio','A scene based on the audience idea.',(SELECT version FROM stories WHERE id=?),?,1,1,?, ?,50,?,'points')`,
    )
    .run(
      id,
      story,
      story,
      id,
      JSON.stringify({
        title: "The key",
        englishPrompt: "Mara finds a second mark.",
        rejected: false,
      }),
      points,
      JSON.stringify(proposals),
    );
}
function publish(s: ReturnType<typeof setup>, id: string) {
  s.db
    .prepare(
      "UPDATE stories SET active_task_id=? WHERE id=(SELECT story_id FROM tasks WHERE id=?)",
    )
    .run(id, id);
  s.db
    .prepare(
      "UPDATE tasks SET status='NeedsModeration',media_ready=1,media_key='accepted.mp4',media_duration_ms=10000,reviewer_id='dev-studio',approved_summary='Mara discovers a mark on the key.' WHERE id=?",
    )
    .run(id);
  s.db
    .prepare(
      "UPDATE tasks SET status='Published',updated_at=updated_at+1 WHERE id=?",
    )
    .run(id);
}

test("audience proposals are private, idempotent and free; host adoption preserves separate credits", async () => {
  const s = setup();
  try {
    const before = JSON.stringify(
      s.db.prepare("SELECT * FROM paid_credit_accounts").all(),
    );
    const { id, input } = await proposal(s);
    assert.equal(
      (await s.call("/stories/last-light/proposals", input, "dev-creator"))
        .status,
      200,
    );
    assert.equal(
      s.db.prepare("SELECT COUNT(*) n FROM model_calls").get()!.n,
      0,
    );
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM tasks").get()!.n, 0);
    assert.equal(
      JSON.stringify(s.db.prepare("SELECT * FROM paid_credit_accounts").all()),
      before,
    );
    assert.equal(
      (
        (await (
          await s.call(
            "/stories/last-light/proposals",
            undefined,
            "dev-newcomer",
          )
        ).json()) as any
      ).proposals.length,
      0,
    );
    draft(s, "adopted", "last-light", [id]);
    assert.equal(
      (
        await s.call(
          `/proposals/${id}/decision`,
          { action: "withdraw" },
          "dev-creator",
        )
      ).status,
      409,
    );
    assert.throws(
      () => draft(s, "duplicate", "last-light", [id]),
      /proposal_changed/,
    );
    await acceptTask(s.env, await getTask(s.env, "adopted"));
    assert.equal(
      s.db
        .prepare(
          "SELECT reserved FROM paid_credit_accounts WHERE user_id='dev-studio'",
        )
        .get()!.reserved,
      5,
    );
    assert.equal(
      s.db
        .prepare(
          "SELECT reserved FROM paid_credit_accounts WHERE user_id='dev-creator'",
        )
        .get()!.reserved,
      0,
    );
    publish(s, "adopted");
    const scenes = await getScenes(s.env, "last-light");
    const scene = scenes.at(-1)!;
    assert.equal(scene.authorId, "dev-studio");
    assert.equal(scene.contributors[0].id, "dev-creator");
    assert.equal(scene.contributors[0].prompt, input.prompt);
    assert.equal(
      s.db.prepare("SELECT status FROM story_proposals WHERE id=?").get(id)!
        .status,
      "published",
    );
    s.db.exec("UPDATE tasks SET status='Published' WHERE id='adopted'");
    assert.equal(
      s.db
        .prepare(
          "SELECT spent FROM paid_credit_accounts WHERE user_id='dev-studio'",
        )
        .get()!.spent,
      5,
    );
  } finally {
    s.db.close();
  }
});
test("paid text reservations cannot double-spend across stories and return exactly once on failure", async () => {
  const s = setup();
  try {
    s.db.exec(
      "UPDATE paid_credit_accounts SET balance=5 WHERE user_id='dev-studio'",
    );
    draft(s, "first");
    draft(s, "second", "quiet-orbit");
    await acceptTask(s.env, await getTask(s.env, "first"));
    await assert.rejects(
      async () => acceptTask(s.env, await getTask(s.env, "second")),
      /paid_credits_unavailable/,
    );
    assert.equal(
      s.db.prepare("SELECT COUNT(*) n FROM ledger WHERE kind='reserve'").get()!
        .n,
      1,
    );
    s.db.exec(
      "UPDATE tasks SET status='Failed',updated_at=updated_at+1 WHERE id='first'",
    );
    s.db.exec("UPDATE tasks SET status='Failed' WHERE id='first'");
    assert.deepEqual(
      {
        ...s.db
          .prepare(
            "SELECT balance,reserved,spent FROM paid_credit_accounts WHERE user_id='dev-studio'",
          )
          .get(),
      },
      { balance: 5, reserved: 0, spent: 0 },
    );
    await acceptTask(s.env, await getTask(s.env, "second"));
    s.db.exec(
      "UPDATE paid_credit_accounts SET balance=0 WHERE user_id='dev-studio'",
    );
    assert.throws(
      () =>
        s.db.exec(
          "UPDATE tasks SET provider_attempt_id='blocked-attempt' WHERE id='second'",
        ),
      /paid_credits_unavailable/,
    );
  } finally {
    s.db.close();
  }
});
test("withdrawal wins over host selection, and failed production releases a proposal for reuse", async () => {
  const s = setup();
  try {
    const p = await proposal(s);
    assert.equal(
      (
        await s.call(
          `/proposals/${p.id}/decision`,
          { action: "withdraw" },
          "dev-newcomer",
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await s.call(
          `/proposals/${p.id}/decision`,
          { action: "withdraw" },
          "dev-creator",
        )
      ).status,
      200,
    );
    assert.throws(
      () => draft(s, "withdrawn", "last-light", [p.id]),
      /proposal_changed/,
    );
    const q = await proposal(s);
    draft(s, "released", "last-light", [q.id]);
    s.db.exec("UPDATE tasks SET status='Cancelled' WHERE id='released'");
    draft(s, "reselected", "last-light", [q.id]);
    assert.equal(
      s.db
        .prepare("SELECT selected_task_id FROM story_proposals WHERE id=?")
        .get(q.id)!.selected_task_id,
      "reselected",
    );
  } finally {
    s.db.close();
  }
});
test("uploads require the actual host, stay free with generation closed, and reject changed canon", async () => {
  const s = setup();
  try {
    const input = {
      idempotencyKey: randomUUID(),
      title: "The mark",
      summary: "Mara finds a second mark on the brass key.",
      bridge: "She remains at the lighthouse door, holding the same key.",
      events: ["Mara finds a second mark."],
      characterIds: ["mara-vale"],
      bytes: 100,
      rightsAccepted: true,
    };
    assert.equal(
      (await s.call("/stories/last-light/uploads", input, "dev-creator"))
        .status,
      403,
    );
    const response = await s.call("/stories/last-light/uploads", input);
    assert.equal(response.status, 201);
    const task = ((await response.json()) as any).task;
    assert.equal(
      (await s.call(`/production/${task.id}/file`, {}, "dev-creator", "PUT"))
        .status,
      404,
    );
    await assert.rejects(
      async () => acceptTask(s.env, await getTask(s.env, task.id)),
      /upload_not_ready/,
    );
    s.db
      .prepare(
        "UPDATE tasks SET media_ready=1,media_key='upload.mp4',media_duration_ms=30000 WHERE id=?",
      )
      .run(task.id);
    s.db.exec(
      "UPDATE settings SET generation_enabled=0; UPDATE provider_wallet SET balance_cents=0,checked_at=0;",
    );
    await acceptTask(s.env, await getTask(s.env, task.id));
    assert.equal(
      s.db.prepare("SELECT SUM(reserved) n FROM paid_credit_accounts").get()!.n,
      0,
    );
    assert.throws(
      () =>
        s.db
          .prepare(
            "UPDATE tasks SET provider_attempt_id='forbidden' WHERE id=?",
          )
          .run(task.id),
      /upload_cannot_generate/,
    );
    s.db
      .prepare("UPDATE tasks SET status='NeedsReview' WHERE id=?")
      .run(task.id);
    s.db.exec("UPDATE stories SET version=version+1 WHERE id='last-light'");
    await assert.rejects(
      async () => acceptTask(s.env, await getTask(s.env, task.id)),
      /upload_not_ready/,
    );
    assert.equal(
      (
        await s.call(`/production/${task.id}/review-continuity`, {
          version: 4,
          continuityAccepted: true,
        })
      ).status,
      200,
    );
    await acceptTask(s.env, await getTask(s.env, task.id));
  } finally {
    s.db.close();
  }
});
test("migration keeps historical free text and paid reference contracts, and preserves old text writers during rollout", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const file of readdirSync("migrations")
      .sort()
      .filter((f) => f < "0022"))
      for (const sql of unstable_splitSqlQuery(
        readFileSync(`migrations/${file}`, "utf8"),
      ))
        db.exec(sql);
    db.exec(readFileSync("fixtures/seed.sql", "utf8"));
    db.exec(
      "INSERT INTO tasks(id,story_id,user_id,prompt_original,base_version,idempotency_key,created_at,updated_at) VALUES('old-free','last-light','dev-creator','An existing free draft.',3,'old-free',1,1)",
    );
    db.exec(
      "INSERT INTO tasks(id,story_id,user_id,prompt_original,base_version,idempotency_key,created_at,updated_at,generation_mode,quoted_points,quoted_reserve_cents) VALUES('old-paid','last-light','dev-creator','An existing paid draft.',3,'old-paid',1,1,'reference',20,100)",
    );
    for (const sql of unstable_splitSqlQuery(
      readFileSync("migrations/0022_story_production.sql", "utf8"),
    ))
      db.exec(sql);
    assert.equal(
      db.prepare("SELECT billing_kind FROM tasks WHERE id='old-free'").get()!
        .billing_kind,
      "legacy-free",
    );
    assert.equal(
      db.prepare("SELECT billing_kind FROM tasks WHERE id='old-paid'").get()!
        .billing_kind,
      "points",
    );
    assert.equal(
      db
        .prepare(
          "SELECT dflt_value FROM pragma_table_info('tasks') WHERE name='billing_kind'",
        )
        .get()!.dflt_value,
      "'legacy-free'",
    );
    assert.equal(
      db.prepare("SELECT text_points FROM settings").get()!.text_points,
      0,
    );
  } finally {
    db.close();
  }
});
