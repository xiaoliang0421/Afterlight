import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { assessSpeech } from "../shared/speech";
import {
  speechRequestBody,
  startSpeechCheck,
  refreshSpeechCheck,
  speechDto,
  reconcileSpeechChecks,
} from "../worker/speech";
import { adaptD1, migrateFixture } from "./support/database";
const requestId = "c785ebd5-635d-4b3a-a228-7f62af66bb6d";
const transcript = {
  text: "The door is open.",
  language_code: "eng",
  language_probability: 0.92,
  words: [
    { text: "The door", type: "word", start: 1, end: 2 },
    { text: "is open.", type: "word", start: 2.1, end: 3 },
  ],
};
function setup() {
  const db = new DatabaseSync(":memory:");
  migrateFixture(db);
  db.exec(
    "INSERT INTO tasks(id,story_id,user_id,prompt_original,base_version,idempotency_key,created_at,updated_at,status,media_key,media_duration_ms,media_ready) VALUES('speech-test','last-light','dev-creator','Private speech idea',3,'speech-test',1,1,'NeedsModeration','stories/last-light/tasks/speech-test/original.mp4',10000,1)",
  );
  const env = {
    DB: adaptD1(db),
    PROVIDER_MODE: "live",
    FAL_KEY: "TEST_SENTINEL",
    MEDIA: {
      async get() {
        return {
          size: 10,
          etag: "etag-1",
          body: new Blob([new Uint8Array(10)]).stream(),
        };
      },
      async head() {
        return { etag: "etag-1" };
      },
    },
  } as unknown as Cloudflare.Env;
  return { db, env };
}
test("speech assessment flags mixed/uncertain language and invalid timing without inventing silence or unsafe captions", () => {
  const good = assessSpeech(transcript, 10000);
  assert.equal(good.verdict, "english-likely");
  assert.match(good.captions, /00:00:01.000 --> 00:00:03.000/);
  for (const data of [
    { ...transcript, language_code: "zho" },
    { ...transcript, language_probability: 0.4 },
    { ...transcript, text: "", words: [] },
    {
      ...transcript,
      words: [{ text: "你好", type: "word", start: 1, end: 2 }],
    },
  ])
    assert.equal(assessSpeech(data, 10000).verdict, "review-required");
  const invalid = assessSpeech(
    {
      ...transcript,
      words: [{ text: "late", type: "word", start: 1, end: 12 }],
    },
    10000,
  );
  assert.equal(invalid.captions, "WEBVTT\n\n");
  const escaped = assessSpeech(
    {
      ...transcript,
      words: [
        { text: "<script> & -->\nWEBVTT", type: "word", start: 1, end: 2 },
      ],
    },
    10000,
  );
  assert.ok(!escaped.captions.includes("<script>"));
  assert.ok(!escaped.captions.includes("\nWEBVTT"));
  assert.throws(() =>
    assessSpeech({ ...transcript, language_probability: 4 }, 10000),
  );
});
test("concurrent speech starts charge once; polling resumes with GETs and the original language remains unforced", async (t) => {
  const { db, env } = setup();
  let posts = 0;
  const methods: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: any, options: any) => {
    const method = options?.method ?? "GET";
    methods.push(method);
    if (method === "POST") {
      posts++;
      const input = JSON.parse(await new Response(options.body).text());
      assert.equal(input.language_code, undefined);
      assert.equal(input.keyterms, undefined);
      assert.match(input.audio_url, /^data:video\/mp4;base64,/);
      return Response.json({
        request_id: requestId,
        status_url:
          "https://queue.fal.run/fal-ai/elevenlabs/requests/" +
          requestId +
          "/status",
        response_url:
          "https://queue.fal.run/fal-ai/elevenlabs/requests/" + requestId,
      });
    }
    return Response.json(
      String(url).endsWith("/status") ? { status: "COMPLETED" } : transcript,
    );
  });
  const results = await Promise.allSettled([
    startSpeechCheck(env, "speech-test"),
    startSpeechCheck(env, "speech-test"),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  await startSpeechCheck(env, "speech-test");
  assert.equal(posts, 1);
  await refreshSpeechCheck(env, "speech-test");
  await refreshSpeechCheck(env, "speech-test");
  assert.deepEqual(methods, ["POST", "GET", "GET"]);
  assert.equal(
    (await speechDto(env, "speech-test"))!.result.verdict,
    "english-likely",
  );
  assert.equal(
    db
      .prepare(
        "SELECT SUM(cents) AS n FROM ledger WHERE kind='speech-cost-ceiling'",
      )
      .get()!.n,
    10,
  );
  assert.equal(
    db.prepare("SELECT debited_cents FROM provider_wallet").get()!
      .debited_cents,
    10,
  );
  db.close();
});
test("speech budget/freshness failures make no paid call and a lost response cannot trigger a retry", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("lost response");
  });
  for (const sql of [
    "UPDATE settings SET authorized_spend_cents=9",
    "UPDATE provider_wallet SET checked_at=0",
    "UPDATE provider_wallet SET balance_cents=9",
  ]) {
    const { db, env } = setup();
    db.exec(sql);
    await assert.rejects(startSpeechCheck(env, "speech-test"));
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM speech_checks").get()!.n,
      0,
    );
    db.close();
  }
  assert.equal(calls, 0);
  const { db, env } = setup();
  await startSpeechCheck(env, "speech-test");
  assert.equal((await speechDto(env, "speech-test"))!.status, "uncertain");
  await startSpeechCheck(env, "speech-test");
  await reconcileSpeechChecks(env);
  assert.equal(calls, 1);
  assert.equal(
    db
      .prepare(
        "SELECT SUM(cents) AS n FROM ledger WHERE kind='speech-cost-ceiling'",
      )
      .get()!.n,
    10,
  );
  db.close();
});
test("speech outputs cannot leak into another media version and active speech blocks account erasure", async (t) => {
  const { db, env } = setup();
  let n = 0;
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      n++ === 0
        ? {
            request_id: requestId,
            status_url: "https://queue.fal.run/test/status",
            response_url: "https://queue.fal.run/test/result",
          }
        : { status: "COMPLETED" },
    ),
  );
  await startSpeechCheck(env, "speech-test");
  (env.MEDIA as any).head = async () => ({ etag: "changed" });
  await assert.rejects(refreshSpeechCheck(env, "speech-test"), /changed/);
  db.exec(
    "UPDATE tasks SET status='Failed' WHERE id='speech-test'; INSERT INTO account_requests(id,user_id,kind,reason,created_at) VALUES('speech-delete','dev-creator','deletion','',1); INSERT INTO account_deletions(request_id,user_id,reviewer_id,policy_version,reviewed_content,created_at) VALUES('speech-delete','dev-creator','dev-studio','test',1,1)",
  );
  assert.throws(
    () => db.exec("UPDATE users SET deleted_at=5 WHERE id='dev-creator'"),
    /deletion_active_speech_check/,
  );
  db.exec(
    "UPDATE speech_checks SET status='closed' WHERE task_id='speech-test'; UPDATE users SET deleted_at=5 WHERE id='dev-creator'",
  );
  assert.equal(
    db.prepare("SELECT result_json,status_url FROM speech_checks").get()!
      .status_url,
    null,
  );
  db.close();
});

test("speech data input streams arbitrary chunk boundaries without changing bytes", async () => {
  const bytes = Uint8Array.from({ length: 150007 }, (_, i) => i % 256);
  for (const size of [1, 7, 16385, 65536]) {
    let offset = 0;
    const source = new ReadableStream<Uint8Array>({
      pull(c) {
        if (offset === bytes.length) c.close();
        else {
          c.enqueue(bytes.slice(offset, offset + size));
          offset = Math.min(bytes.length, offset + size);
        }
      },
    });
    const input = JSON.parse(
      await new Response(speechRequestBody(source)).text(),
    );
    assert.deepEqual(
      Buffer.from(input.audio_url.split(",")[1], "base64"),
      Buffer.from(bytes),
    );
    assert.equal(input.language_code, undefined);
  }
});
