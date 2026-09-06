import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { unstable_splitSqlQuery } from "wrangler";
import { selectedMaterials } from "../worker/materials";

function database() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").sort()) {
    for (const statement of unstable_splitSqlQuery(
      readFileSync(`migrations/${file}`, "utf8"),
    ))
      db.exec(statement);
  }
  db.exec(readFileSync("fixtures/seed.sql", "utf8"));
  db.exec(`INSERT INTO credit_accounts VALUES('dev-creator','2026-09-06',3,0,0),('dev-studio','2026-09-06',3,0,0);
    INSERT INTO budget_periods VALUES('day','2026-09-06',3000,0,0),('month','2026-09',10000,0,0);`);
  return db;
}
const now = 1788669000000;
test("a requested cast is immutable, unique and restricted to introduced characters in its story", () => {
  const db = database();
  const insert = db.prepare(
    "INSERT INTO tasks(id,story_id,user_id,prompt_original,idempotency_key,base_version,created_at,updated_at,requested_character_ids_json) VALUES(?,'last-light','dev-creator','Mara examines the brass key.',?,3,1,1,?)",
  );
  for (const [id, cast] of [
    ["foreign", ["inez-sol"]],
    ["duplicate", ["mara-vale", "mara-vale"]],
    ["missing", ["someone-new"]],
  ] as const)
    assert.throws(
      () => insert.run(id, id, JSON.stringify(cast)),
      /invalid_requested_cast/,
    );
  db.exec(
    "INSERT INTO characters(id,story_id,name,description,state,introduced_version) VALUES('future','last-light','Future arrival','A person not yet introduced.','Outside the story.',99)",
  );
  assert.throws(
    () => insert.run("future", "future", '["future"]'),
    /invalid_requested_cast/,
  );
  insert.run("valid", "valid", '["mara-vale"]');
  assert.throws(
    () =>
      db.exec(
        "UPDATE tasks SET requested_character_ids_json='[]' WHERE id='valid'",
      ),
    /requested_cast_is_immutable/,
  );
  assert.equal(
    db
      .prepare(
        "SELECT requested_character_ids_json AS cast FROM tasks WHERE id='valid'",
      )
      .get()?.cast,
    '["mara-vale"]',
  );
  db.close();
});
function draft(
  db: DatabaseSync,
  id: string,
  story = "last-light",
  user = "dev-creator",
) {
  const version = (
    db.prepare("SELECT version FROM stories WHERE id=?").get(story) as {
      version: number;
    }
  ).version;
  const plan = JSON.stringify({
    title: "The next scene",
    englishPrompt: "A light appears beside the old door.",
  });
  db.prepare(
    `INSERT INTO tasks(id,story_id,user_id,prompt_original,base_version,idempotency_key,plan_json,approved_plan_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    story,
    user,
    "Original multilingual idea 灯亮了",
    version,
    id,
    plan,
    plan,
    now,
    now,
  );
}
function accept(db: DatabaseSync, id: string, timestamp = now + 1) {
  return db
    .prepare(
      `UPDATE tasks SET status='Queued',quota_period='2026-09-06',budget_day='2026-09-06',budget_month='2026-09',reserved_cents=150,updated_at=? WHERE id=? AND status IN ('Draft','NeedsReview')`,
    )
    .run(timestamp, id);
}
function ready(db: DatabaseSync, id: string) {
  db.prepare(
    "UPDATE stories SET active_task_id=? WHERE id=(SELECT story_id FROM tasks WHERE id=?)",
  ).run(id, id);
  db.prepare(
    `UPDATE tasks SET status='NeedsModeration',media_ready=1,media_key='test.mp4',captions_key='test.vtt',media_duration_ms=10000,reviewer_id='dev-studio',approved_summary='A light is visible beside the door.',approved_events_json='["A light appeared."]',recorded_cost_cents=120,updated_at=? WHERE id=?`,
  ).run(now + 2, id);
}
function publish(db: DatabaseSync, id: string) {
  db.prepare(`UPDATE tasks SET status='Published',updated_at=? WHERE id=?`).run(
    now + 3,
    id,
  );
}
function numbers(db: DatabaseSync) {
  return {
    credit: db
      .prepare(
        "SELECT reserved,spent FROM credit_accounts WHERE user_id='dev-creator' AND period='2026-09-06'",
      )
      .get(),
    wallet: db
      .prepare("SELECT reserved_cents,debited_cents FROM provider_wallet")
      .get(),
    budget: db
      .prepare(
        "SELECT reserved_cents,spent_cents FROM budget_periods WHERE kind='day'",
      )
      .get(),
  };
}
test("admission records the approved plan and policy atomically with its actual queue sequence", () => {
  const db = database();
  draft(db, "consented");
  db.prepare(
    "UPDATE tasks SET terms_version='2026-09-06-draft',attribution_accepted_at=?,attribution_plan_version=? WHERE id='consented'",
  ).run(now, now);
  accept(db, "consented");
  const first = db
    .prepare("SELECT * FROM contribution_acceptances WHERE task_id='consented'")
    .get()!;
  const task = db.prepare("SELECT * FROM tasks WHERE id='consented'").get()!;
  assert.equal(first.queue_sequence, task.queue_sequence);
  assert.equal(first.user_id, "dev-creator");
  assert.equal(first.plan_version, now);
  assert.equal(first.approved_plan_json, task.approved_plan_json);
  accept(db, "consented");
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM contribution_acceptances").get()!.n,
    1,
  );
  db.prepare(
    "UPDATE tasks SET status='NeedsReview',updated_at=? WHERE id='consented'",
  ).run(now + 2);
  db.prepare(
    "UPDATE tasks SET approved_plan_json='{}',attribution_plan_version=? WHERE id='consented'",
  ).run(now + 2);
  accept(db, "consented", now + 3);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM contribution_acceptances").get()!.n,
    2,
  );
  assert.equal(
    db
      .prepare(
        "SELECT approved_plan_json FROM contribution_acceptances ORDER BY queue_sequence LIMIT 1",
      )
      .get()!.approved_plan_json,
    first.approved_plan_json,
  );
});
test("new characters require matching approved material and inherit the version actually used", async () => {
  const db = database();
  draft(db, "candidate");
  const plan = {
    characterIds: ["new-person"],
    newCharacters: [
      {
        id: "new-person",
        name: "June",
        description: "A courier wearing a charcoal jacket.",
        state: "At the door.",
      },
    ],
  };
  const env = {
    DB: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          all: async () => ({
            results: db.prepare(sql).all(...(args as any[])),
          }),
        }),
      }),
    },
  } as unknown as Cloudflare.Env;
  await assert.rejects(
    () => selectedMaterials(env, "candidate", "last-light", plan as any),
    /approve/,
  );
  db.prepare("INSERT INTO candidate_materials VALUES(?,?,?,?,?,?,?,?,?,?)").run(
    "candidate",
    "new-person",
    "last-light",
    "June",
    plan.newCharacters[0].description,
    "https://assets.example.com/v1.png",
    null,
    null,
    "dev-studio",
    now,
  );
  const materials = await selectedMaterials(
    env,
    "candidate",
    "last-light",
    plan as any,
  );
  assert.equal(
    materials[0].referenceImage,
    "https://assets.example.com/v1.png",
  );
  await assert.rejects(
    () =>
      selectedMaterials(env, "candidate", "last-light", {
        ...plan,
        newCharacters: [{ ...plan.newCharacters[0], name: "Someone else" }],
      } as any),
    /approve/,
  );
  db.prepare(
    "UPDATE tasks SET approved_new_characters_json=?,material_snapshot_json=? WHERE id=?",
  ).run(
    JSON.stringify(plan.newCharacters),
    JSON.stringify({ characters: materials }),
    "candidate",
  );
  accept(db, "candidate");
  ready(db, "candidate");
  db.exec(
    "UPDATE candidate_materials SET reference_image='https://assets.example.com/v2.png'",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM characters WHERE id='new-person'").get()!
      .n,
    0,
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM story_archives").get()!.n, 0);
  publish(db, "candidate");
  const character = db
    .prepare(
      "SELECT reference_image,introduced_version FROM characters WHERE story_id='last-light' AND id='new-person'",
    )
    .get()!;
  assert.equal(character.reference_image, "https://assets.example.com/v1.png");
  assert.equal(character.introduced_version, 4);
  const history = db
    .prepare(
      "SELECT * FROM character_history WHERE story_id='last-light' AND character_id='new-person'",
    )
    .all();
  assert.equal(history.length, 1);
  assert.equal(history[0].version, 4);
  assert.equal(history[0].source_scene_id, "candidate");
  assert.equal(history[0].state, "At the door.");
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM character_history WHERE character_id='new-person' AND version<4",
      )
      .get()!.n,
    0,
  );
  publish(db, "candidate");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM story_archives").get()!.n, 1);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM story_archives WHERE story_id='quiet-orbit'",
      )
      .get()!.n,
    0,
  );
  db.close();
});

test("all migrations survive the actual Wrangler SQL splitter", () => {
  const db = database();
  assert.ok(
    db
      .prepare("SELECT name FROM sqlite_master WHERE name='publish_scene'")
      .get(),
  );
  db.close();
});
test("accept is idempotent and reservations cannot be spent twice", () => {
  const db = database();
  draft(db, "a");
  accept(db, "a");
  accept(db, "a");
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM ledger WHERE kind='reserve'").get()!.n,
    1,
  );
  assert.equal(numbers(db).credit!.reserved, 1);
  draft(db, "b");
  assert.throws(() => accept(db, "b"), /already_in_queue/);
  assert.equal(numbers(db).wallet!.reserved_cents, 150);
  db.close();
});
test("stories have independent queues, scenes, permanent character IDs and playback progress", () => {
  const db = database();
  draft(db, "a");
  draft(db, "b", "quiet-orbit");
  accept(db, "a");
  accept(db, "b");
  ready(db, "a");
  ready(db, "b");
  publish(db, "b");
  assert.equal(
    db.prepare("SELECT version FROM stories WHERE id='last-light'").get()!
      .version,
    3,
  );
  assert.equal(
    db.prepare("SELECT version FROM stories WHERE id='quiet-orbit'").get()!
      .version,
    2,
  );
  assert.equal(
    db.prepare("SELECT status FROM tasks WHERE id='a'").get()!.status,
    "NeedsModeration",
  );
  assert.throws(
    () =>
      db.exec(
        "INSERT INTO watch_progress VALUES('dev-creator','last-light','quiet-orbit:episode:1',10,1)",
      ),
    /FOREIGN KEY/,
  );
  db.close();
});
test("publication atomically commits author, actual events, timing and one credit", () => {
  const db = database();
  draft(db, "a");
  accept(db, "a");
  ready(db, "a");
  publish(db, "a");
  publish(db, "a");
  const scene = db.prepare("SELECT * FROM scenes WHERE id='a'").get()!;
  assert.equal(scene.author_id, "dev-creator");
  assert.equal(scene.start_ms, 30000);
  assert.equal(scene.version, 4);
  assert.equal(scene.prompt_original, "Original multilingual idea 灯亮了");
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM canon_events WHERE scene_id='a'").get()!
      .n,
    1,
  );
  assert.equal(numbers(db).credit!.spent, 1);
  assert.equal(numbers(db).credit!.reserved, 0);
  assert.equal(numbers(db).budget!.spent_cents, 120);
  assert.equal(numbers(db).wallet!.reserved_cents, 0);
  assert.equal(
    db
      .prepare("SELECT active_task_id FROM stories WHERE id='last-light'")
      .get()!.active_task_id,
    null,
  );
  db.prepare(
    "UPDATE users SET display_name='River' WHERE id='dev-creator'",
  ).run();
  assert.equal(
    db
      .prepare(
        "SELECT display_name FROM scenes JOIN users ON users.id=scenes.author_id WHERE scenes.id='a'",
      )
      .get()!.display_name,
    "River",
  );
  db.close();
});
test("publication with a stale parent rolls back all side effects and keeps reservation", () => {
  const db = database();
  draft(db, "a");
  accept(db, "a");
  ready(db, "a");
  db.exec("UPDATE stories SET version=4 WHERE id='last-light'");
  assert.throws(() => publish(db, "a"), /story_version_conflict/);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM scenes WHERE id='a'").get()!.n,
    0,
  );
  assert.equal(numbers(db).credit!.reserved, 1);
  assert.equal(numbers(db).credit!.spent, 0);
  db.close();
});
test("duplicate new character rolls back publication and its ledger", () => {
  const db = database();
  draft(db, "a");
  accept(db, "a");
  ready(db, "a");
  db.prepare("UPDATE tasks SET approved_new_characters_json=? WHERE id=?").run(
    JSON.stringify([
      {
        id: "mara-vale",
        name: "Other Mara",
        description: "A conflicting character",
        state: "arrives",
      },
    ]),
    "a",
  );
  assert.throws(() => publish(db, "a"), /UNIQUE/);
  assert.equal(
    db.prepare("SELECT version FROM stories WHERE id='last-light'").get()!
      .version,
    3,
  );
  assert.equal(numbers(db).credit!.reserved, 1);
  db.close();
});
test("unknown paid request retains money until explicit reconciliation; user is refunded on failure", () => {
  const db = database();
  draft(db, "a");
  accept(db, "a");
  db.exec(
    "UPDATE tasks SET status='ReconciliationNeeded',provider_attempt_id='attempt' WHERE id='a'",
  );
  assert.equal(numbers(db).wallet!.reserved_cents, 150);
  assert.equal(numbers(db).credit!.reserved, 1);
  db.exec(
    "UPDATE tasks SET status='Failed',recorded_cost_cents=75,updated_at=1788669000004 WHERE id='a'",
  );
  assert.equal(numbers(db).wallet!.reserved_cents, 0);
  assert.equal(numbers(db).wallet!.debited_cents, 75);
  assert.equal(numbers(db).credit!.spent, 0);
  assert.equal(numbers(db).credit!.reserved, 0);
  db.close();
});
test("cancellation releases the original day reservation across a UTC reset", () => {
  const db = database();
  draft(db, "a");
  accept(db, "a");
  db.exec(
    "INSERT INTO credit_accounts VALUES('dev-creator','2026-09-07',3,0,0)",
  );
  db.exec(
    "UPDATE tasks SET status='Cancelled',updated_at=1788739200001 WHERE id='a'",
  );
  assert.equal(numbers(db).credit!.reserved, 0);
  assert.equal(
    db
      .prepare("SELECT reserved FROM credit_accounts WHERE period='2026-09-07'")
      .get()!.reserved,
    0,
  );
  db.close();
});
test("stale provider balance, global budget and lifetime authorization block admission atomically", () => {
  for (const setup of [
    "UPDATE provider_wallet SET checked_at=0",
    "UPDATE budget_periods SET limit_cents=100 WHERE kind='day'",
    "UPDATE settings SET authorized_spend_cents=100",
  ]) {
    const db = database();
    draft(db, "a");
    db.exec(setup);
    assert.throws(() => accept(db, "a"), /balance_stale|capacity_full/);
    assert.equal(numbers(db).credit!.reserved, 0);
    assert.equal(numbers(db).wallet!.reserved_cents, 0);
    db.close();
  }
});
test("platform ceiling includes director costs and in-flight scenes across stories", () => {
  const db = database();
  db.exec("UPDATE settings SET authorized_spend_cents=170");
  draft(db, "a");
  accept(db, "a");
  assert.throws(
    () =>
      db.exec(
        `INSERT INTO model_calls(id,task_id,day,month,cost_ceiling_cents,kind,status,created_at) VALUES('call','a','2026-09-06','2026-09',25,'preview','submitted',1)`,
      ),
    /capacity_full/,
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM model_calls").get()!.n, 0);
  db.close();
});
test("episodes close at the target duration and the next scene opens a new chapter", () => {
  const db = database();
  db.exec("UPDATE episodes SET duration_ms=170000 WHERE story_id='last-light'");
  draft(db, "a");
  accept(db, "a");
  ready(db, "a");
  publish(db, "a");
  assert.equal(
    db
      .prepare("SELECT status FROM episodes WHERE id='last-light:episode:1'")
      .get()!.status,
    "complete",
  );
  draft(db, "b");
  accept(db, "b");
  ready(db, "b");
  publish(db, "b");
  const scene = db
    .prepare("SELECT episode_id,start_ms FROM scenes WHERE id='b'")
    .get()!;
  assert.equal(scene.episode_id, "last-light:episode:2");
  assert.equal(scene.start_ms, 0);
  db.close();
});
