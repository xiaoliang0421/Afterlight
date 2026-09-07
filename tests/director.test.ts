import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  applyContinuityAudit,
  parseDirectorPlan,
  preparePlan,
} from "../worker/director";
import { AppError } from "../worker/errors";
import { acceptTask, getTask } from "../worker/store";
import { adaptD1, migrateFixture } from "./support/database";
import type { ScenePlan } from "../shared/domain";
import { callEditor } from "../worker/editor";

test("editor response assembly preserves bytes when an upstream stream reuses its buffer", async () => {
  const db = new DatabaseSync(":memory:");
  migrateFixture(db);
  const originalFetch = globalThis.fetch;
  const expected = JSON.stringify({ message: "A letter — and a clue." });
  const payload = new TextEncoder().encode(
    JSON.stringify({
      choices: [{ message: { content: expected } }],
      usage: { prompt_tokens: 15, completion_tokens: 12 },
    }),
  );
  const buffer = new Uint8Array(17);
  let cursor = 0;
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream(
        {
          pull(controller) {
            if (cursor === payload.length) {
              controller.close();
              return;
            }
            const size = Math.min(buffer.length, payload.length - cursor);
            buffer.set(payload.subarray(cursor, cursor + size));
            cursor += size;
            controller.enqueue(buffer.subarray(0, size));
          },
        },
        { highWaterMark: 0 },
      ),
    );
  const env = {
    DB: adaptD1(db),
    PROVIDER_MODE: "live",
    ENVIRONMENT: "development",
    DIRECTOR_API_KEY: "test-only",
    DIRECTOR_API_URL: "https://api.deepseek.com/chat/completions",
    DIRECTOR_MODEL: "test-editor",
  } as unknown as Cloudflare.Env;
  try {
    db.prepare(
      "INSERT INTO tasks(id,story_id,user_id,prompt_original,base_version,idempotency_key,created_at,updated_at) VALUES('stream','last-light','dev-creator','Mara examines her key.',3,'stream',1,1)",
    ).run();
    assert.equal(
      await callEditor(
        env,
        { id: "stream", user_id: "dev-creator" },
        "preview",
        "Test",
        {},
      ),
      expected,
    );
    assert.equal(
      db.prepare("SELECT status FROM model_calls").get()?.status,
      "completed",
    );
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

const valid = (): ScenePlan => ({
  englishPrompt: "Mara studies the brass key beside the locked door.",
  title: "A closer look",
  summary: "Mara studies the brass key while the storm continues.",
  bridge: "Mara remains at the entrance.",
  videoPrompt:
    "Mara lifts the key in her hand and studies its markings beside the door.",
  language: "en",
  durationSeconds: 10,
  characterIds: ["mara-vale"],
  newCharacters: [],
  proposedEvents: ["Mara studies the key."],
  characterUpdates: [],
  requiresReview: false,
  majorChanges: [],
  reason: "",
  rejected: false,
});
const invalidPlan = (error: unknown) =>
  error instanceof AppError &&
  error.code === "director_response_invalid" &&
  error.status === 503;

test("invalid editor output stays blocked with an actionable error and no exposed raw output", () => {
  assert.throws(() => parseDirectorPlan("not JSON"), invalidPlan);
  assert.throws(
    () => parseDirectorPlan(JSON.stringify({ ...valid(), videoPrompt: "" })),
    invalidPlan,
  );
  const missing = { ...valid() } as any;
  delete missing.majorChanges;
  assert.throws(
    () => parseDirectorPlan(JSON.stringify(missing)),
    (e: unknown) =>
      e instanceof AppError && e.code === "director_review_missing",
  );
  assert.deepEqual(parseDirectorPlan(JSON.stringify(valid())), valid());
  const candidate = parseDirectorPlan(
    JSON.stringify({
      ...valid(),
      newCharacters: [
        {
          id: "june",
          name: "June",
          description: "A courier in a yellow coat.",
          state: "At the entrance.",
          referenceImage: null,
          voiceReference: "https://untrusted.invalid/voice",
        },
      ],
    }),
  );
  assert.deepEqual(Object.keys(candidate.newCharacters[0]).sort(), [
    "description",
    "id",
    "name",
    "state",
  ]);
});

test("continuity review can tighten decisions but cannot clear rejection, owner flags or rewrite a scene", () => {
  const plan = valid();
  plan.majorChanges = ["identity-change"];
  plan.rejected = true;
  plan.requiresReview = true;
  plan.reason = "Established identities conflict.";
  const before = structuredClone(plan);
  applyContinuityAudit(
    plan,
    JSON.stringify({
      verdict: "consistent",
      reason: "",
      majorChanges: [],
      characterIds: ["intruder"],
    }),
  );
  assert.deepEqual(plan, before);
  const ambiguous = applyContinuityAudit(
    valid(),
    JSON.stringify({
      verdict: "needs-review",
      reason: "The entrance is not explained.",
      majorChanges: ["world-rules"],
    }),
  );
  assert.equal(ambiguous.requiresReview, true);
  assert.equal(ambiguous.rejected, false);
  assert.deepEqual(ambiguous.majorChanges, ["world-rules"]);
  assert.throws(
    () => applyContinuityAudit(valid(), '{"verdict":"consistent"}'),
    (e: unknown) =>
      e instanceof AppError && e.code === "continuity_audit_invalid",
  );
});

test("independent live-path audit rejects an invented transition before queue admission and charges only the two editor calls", async () => {
  const db = new DatabaseSync(":memory:");
  migrateFixture(db);
  const originalFetch = globalThis.fetch;
  const seen: any[] = [];
  const initial = valid();
  initial.bridge = "Elias arrives in response to Mara's earlier phone call.";
  const responses = [
    initial,
    {
      verdict: "contradiction",
      reason: "No prior call is published; Elias is still at the workshop.",
      majorChanges: [],
    },
  ];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.deepseek.com/chat/completions");
    assert.equal(init?.method, "POST");
    seen.push(JSON.parse(init?.body as string));
    return Response.json({
      choices: [{ message: { content: JSON.stringify(responses.shift()) } }],
      model: "test-editor",
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    });
  };
  const env = {
    DB: adaptD1(db),
    PROVIDER_MODE: "live",
    ENVIRONMENT: "development",
    DIRECTOR_API_KEY: "test-only",
    DIRECTOR_API_URL: "https://api.deepseek.com/chat/completions",
    DIRECTOR_MODEL: "test-editor",
  } as unknown as Cloudflare.Env;
  try {
    db.prepare(
      "INSERT INTO tasks(id,story_id,user_id,prompt_original,base_version,idempotency_key,created_at,updated_at) VALUES('audit-test','last-light','dev-creator','Mara studies the key.',3,'audit-test',1,1)",
    ).run();
    const canon = JSON.stringify(
      db.prepare("SELECT * FROM canon_events").all(),
    );
    const { plan } = await preparePlan(env, await getTask(env, "audit-test"));
    assert.equal(plan.rejected, true);
    assert.equal(plan.requiresReview, true);
    assert.match(plan.reason, /No prior call/);
    assert.equal(seen.length, 2);
    assert.deepEqual(
      JSON.parse(seen[1].messages[1].content).proposedPlan,
      initial,
    );
    db.prepare("UPDATE tasks SET plan_json=? WHERE id='audit-test'").run(
      JSON.stringify(plan),
    );
    await assert.rejects(
      acceptTask(env, await getTask(env, "audit-test")),
      (e: unknown) => e instanceof AppError && e.code === "idea_rejected",
    );
    assert.equal((await getTask(env, "audit-test")).status, "Draft");
    assert.equal((await getTask(env, "audit-test")).provider_request_id, null);
    assert.equal(
      JSON.stringify(db.prepare("SELECT * FROM canon_events").all()),
      canon,
    );
    assert.deepEqual(
      db
        .prepare("SELECT kind,status FROM model_calls ORDER BY created_at")
        .all()
        .map((r) => ({ ...r })),
      [
        { kind: "preview", status: "completed" },
        { kind: "continuity-audit", status: "completed" },
      ],
    );
    assert.equal(
      (
        db
          .prepare("SELECT SUM(cost_ceiling_cents) AS total FROM model_calls")
          .get() as any
      ).total,
      50,
    );
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test("newcomers receive stable scene anchors and model IDs cannot replace an established character", async () => {
  const db = new DatabaseSync(":memory:");
  migrateFixture(db);
  const originalFetch = globalThis.fetch;
  const initial = {
    ...valid(),
    newCharacters: [
      {
        id: "june",
        name: "June",
        description: "A courier in a yellow raincoat.",
        state: "At the lighthouse entrance.",
        referenceImage: null,
      },
    ],
  };
  let calls = 0;
  globalThis.fetch = async () =>
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify(
              ++calls === 1
                ? initial
                : { verdict: "consistent", reason: "", majorChanges: [] },
            ),
          },
        },
      ],
    });
  const env = {
    DB: adaptD1(db),
    PROVIDER_MODE: "live",
    ENVIRONMENT: "development",
    DIRECTOR_API_KEY: "test-only",
    DIRECTOR_API_URL: "https://api.deepseek.com/chat/completions",
    DIRECTOR_MODEL: "test-editor",
  } as unknown as Cloudflare.Env;
  try {
    db.prepare(
      "INSERT INTO tasks(id,story_id,user_id,prompt_original,base_version,idempotency_key,created_at,updated_at) VALUES('newcomer','last-light','dev-creator','June arrives with a letter.',3,'newcomer',1,1)",
    ).run();
    const { plan } = await preparePlan(env, await getTask(env, "newcomer"));
    assert.deepEqual(plan.characterIds, ["mara-vale", "newcomer:character:1"]);
    assert.equal(plan.newCharacters[0].id, "newcomer:character:1");
    assert.equal(plan.newCharacters[0].referenceImage, undefined);
    initial.newCharacters[0].id = "mara-vale";
    calls = 0;
    await assert.rejects(
      preparePlan(env, await getTask(env, "newcomer")),
      (error: unknown) =>
        error instanceof AppError && error.code === "director_cast_invalid",
    );
    assert.equal(
      calls,
      1,
      "An invalid identity must stop before the additional audit call.",
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM characters WHERE story_id='last-light'",
          )
          .get() as any
      ).n,
      2,
    );
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test("an unreadable upstream response preserves the cost record and never retries a paid editor call", async () => {
  const db = new DatabaseSync(":memory:");
  migrateFixture(db);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('{"choices":');
  };
  const env = {
    DB: adaptD1(db),
    PROVIDER_MODE: "live",
    ENVIRONMENT: "development",
    DIRECTOR_API_KEY: "test-only",
    DIRECTOR_API_URL: "https://api.deepseek.com/chat/completions",
    DIRECTOR_MODEL: "test-editor",
  } as unknown as Cloudflare.Env;
  try {
    db.prepare(
      "INSERT INTO tasks(id,story_id,user_id,prompt_original,base_version,idempotency_key,created_at,updated_at) VALUES('unreadable','last-light','dev-creator','Mara examines her key.',3,'unreadable',1,1)",
    ).run();
    await assert.rejects(
      callEditor(
        env,
        { id: "unreadable", user_id: "dev-creator" },
        "preview",
        "Test rules",
        {},
      ),
      (error: unknown) =>
        error instanceof AppError && error.code === "editor_response_invalid",
    );
    assert.equal(calls, 1);
    assert.deepEqual(
      {
        ...db
          .prepare("SELECT status,cost_ceiling_cents FROM model_calls")
          .get(),
      },
      { status: "submitted", cost_ceiling_cents: 25 },
    );
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});
