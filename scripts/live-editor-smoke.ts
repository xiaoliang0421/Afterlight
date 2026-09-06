// Explicit opt-in only: this script performs four paid text requests, never video generation.
// Credentials arrive through the process environment; no secret is written or logged.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { unstable_splitSqlQuery } from "wrangler";
import { parse } from "jsonc-parser";
import { preparePlan } from "../worker/director";
import { callEditor } from "../worker/editor";
import { ARCHIVE_RULES, archiveContext } from "../worker/archives";
import { validateArchive } from "../shared/archive";
import { getTask } from "../worker/store";

if (!process.argv.includes("--authorized") || !process.env.DIRECTOR_API_KEY)
  throw new Error(
    "Live editor testing requires explicit authorization and a director key in the environment.",
  );
const db = new DatabaseSync(":memory:");
for (const file of readdirSync("migrations").sort())
  for (const sql of unstable_splitSqlQuery(
    readFileSync(`migrations/${file}`, "utf8"),
  ))
    db.exec(sql);
db.exec(readFileSync("fixtures/seed.sql", "utf8"));
// The isolated harness exercises the same D1 SQL and accounting, with a finite four-call workload.
const sql = (query: string, args: unknown[] = []) => ({
  bind: (...values: unknown[]) => sql(query, values),
  first: async () => db.prepare(query).get(...(args as any[])) ?? null,
  all: async () => ({ results: db.prepare(query).all(...(args as any[])) }),
  run: async () => ({ meta: db.prepare(query).run(...(args as any[])) }),
});
const vars = parse(readFileSync("wrangler.jsonc", "utf8")).vars;
const env = {
  ...vars,
  PROVIDER_MODE: "live",
  DIRECTOR_API_KEY: process.env.DIRECTOR_API_KEY,
  DB: {
    prepare: sql,
    batch: async (queries: any[]) => Promise.all(queries.map((q) => q.run())),
  },
} as unknown as Cloudflare.Env;
const cases = [
  {
    id: "smoke-english",
    prompt:
      "让玛拉检查黄铜钥匙上的刻痕，再看向门锁。保持悬念，不要让门立刻打开。",
  },
  {
    id: "smoke-return",
    prompt:
      "让修收音机的埃利亚斯通过对讲机联系玛拉，提醒她留意钥匙上的编号。不要新增角色。",
  },
  {
    id: "smoke-new",
    prompt:
      "一位此前未登场、名叫 June 的邮差来到灯塔门口，递给玛拉一封写着她名字的信。June 是新角色，请合理引入，不要改变玛拉和埃利亚斯的身份。",
  },
];
const results: unknown[] = [];
try {
  for (const item of cases) {
    const now = Date.now();
    db.prepare(
      "INSERT INTO tasks(id,story_id,user_id,prompt_original,base_version,idempotency_key,created_at,updated_at) VALUES(?,'last-light','dev-creator',?,3,?,?,?)",
    ).run(item.id, item.prompt, item.id, now, now);
    const started = Date.now();
    const { plan } = await preparePlan(env, await getTask(env, item.id));
    const checks = {
      english:
        plan.language === "en" &&
        !/[\u3400-\u9fff]/u.test(
          [plan.title, plan.summary, plan.englishPrompt, plan.videoPrompt].join(
            " ",
          ),
        ),
      validExistingIds: plan.characterIds.every((id) =>
        [
          "mara-vale",
          "elias-reed",
          ...plan.newCharacters.map((c) => c.id),
        ].includes(id),
      ),
      candidateIdentity:
        item.id !== "smoke-new"
          ? true
          : plan.newCharacters.some(
              (c) =>
                c.name.toLowerCase().includes("june") &&
                c.id.startsWith(item.id + ":character:"),
            ),
    };
    results.push({
      case: item.id,
      latencyMs: Date.now() - started,
      checks,
      plan,
    });
    console.log(JSON.stringify({ case: item.id, checks, title: plan.title }));
    if (Object.values(checks).some((v) => !v))
      throw new Error("A live plan did not satisfy the expected boundary.");
  }
  const context = await archiveContext(env, {
    story_id: "last-light",
    version: 3,
    scene_id: "sample-light-3",
  } as any);
  const started = Date.now();
  const archive = validateArchive(
    JSON.parse(
      await callEditor(
        env,
        { id: cases[0].id, user_id: "dev-creator" },
        "story-archive",
        ARCHIVE_RULES,
        context,
      ),
    ),
    context,
  );
  results.push({
    case: "smoke-archive",
    latencyMs: Date.now() - started,
    archive,
  });
  console.log(
    JSON.stringify({
      case: "smoke-archive",
      characters: archive.characters.map((c) => c.id),
      concerns: archive.concerns.length,
    }),
  );
  const usage = db
    .prepare(
      "SELECT kind,provider_model,input_tokens,output_tokens,status,cost_ceiling_cents FROM model_calls ORDER BY created_at",
    )
    .all();
  writeFileSync(
    "docs/live-editor-results.json",
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        scope:
          "Four real text calls against a local fixture story; no video generation, publication or production deployment.",
        results,
        usage,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ completed: true, calls: usage.length, usage }));
} catch (error) {
  console.error(
    JSON.stringify({
      completed: false,
      error: error instanceof Error ? error.name : "UnknownError",
      finishedCases: results.length,
    }),
  );
  process.exitCode = 1;
} finally {
  db.close();
}
