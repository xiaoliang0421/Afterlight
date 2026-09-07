// One paid audit of a saved, known-bad fictional plan. No new scene/video request.
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parse } from "jsonc-parser";
import { callEditor } from "../worker/editor";
import {
  applyContinuityAudit,
  CONTINUITY_AUDIT_RULES,
} from "../worker/director";
import { getCharacters, getStory } from "../worker/store";
import { migrateFixture, adaptD1 } from "../tests/support/database";

if (!process.argv.includes("--authorized") || !process.env.DIRECTOR_API_KEY)
  throw new Error(
    "Requires explicit DeepSeek authorization and its Keychain-supplied key.",
  );
const dir = "artifacts/director-audit-replay";
mkdirSync(dir, { recursive: true });
if (existsSync(`${dir}/attempt.json`))
  throw new Error(
    "An audit attempt already exists. Read its saved result; never automatically repeat it.",
  );
const source = JSON.parse(
  readFileSync("docs/live-governance-results.json", "utf8"),
).results.find((r: any) => r.case === "identity-fr-diagnostic");
if (!source?.plan) throw new Error("The saved source plan is required.");
const db = new DatabaseSync(`${dir}/evaluation.sqlite`);
migrateFixture(db);
const env = {
  ...parse(readFileSync("wrangler.jsonc", "utf8")).vars,
  PROVIDER_MODE: "live",
  DIRECTOR_API_KEY: process.env.DIRECTOR_API_KEY,
  DB: adaptD1(db),
} as unknown as Cloudflare.Env;
try {
  db.prepare(
    "INSERT INTO tasks(id,story_id,user_id,prompt_original,base_version,idempotency_key,created_at,updated_at) VALUES('audit-replay','last-light','dev-creator',?,3,'audit-replay',1,1)",
  ).run(source.prompt);
  const story = await getStory(env, "last-light");
  const context = {
    world: {
      title: story.title,
      rules: story.worldRules,
      visualStyle: story.visualStyle,
      version: story.version,
    },
    characters: await getCharacters(env, story.id),
    publishedEvents: db
      .prepare(
        "SELECT version,description FROM canon_events WHERE story_id='last-light' ORDER BY version,id",
      )
      .all(),
    lastScene: db
      .prepare(
        "SELECT summary,version FROM scenes WHERE story_id='last-light' ORDER BY version DESC LIMIT 1",
      )
      .get(),
    userProposal: source.prompt,
    selectedCharacterIds: [],
    previouslyApprovedPlan: null,
    proposedPlan: source.plan,
  };
  writeFileSync(
    `${dir}/attempt.json`,
    JSON.stringify({ state: "started", startedAt: new Date().toISOString() }),
    { flag: "wx", mode: 0o600 },
  );
  const output = await callEditor(
    env,
    { id: "audit-replay", user_id: "dev-creator" },
    "continuity-audit",
    CONTINUITY_AUDIT_RULES,
    context,
  );
  writeFileSync(`${dir}/response.json`, output, { mode: 0o600 });
  const checkedPlan = applyContinuityAudit(
    structuredClone(source.plan),
    output,
  );
  const result = {
    state: "completed",
    testedAt: new Date().toISOString(),
    scope:
      "One real DeepSeek audit of a previously saved flawed fictional plan against local canon. No writer/video call, publication or cloud fixture upload.",
    sourceCase: source.case,
    audit: JSON.parse(output),
    rejected: checkedPlan.rejected,
    reason: checkedPlan.reason,
    usage: db
      .prepare(
        "SELECT kind,status,input_tokens,output_tokens,cost_ceiling_cents FROM model_calls",
      )
      .all(),
  };
  writeFileSync(`${dir}/attempt.json`, JSON.stringify(result, null, 2), {
    mode: 0o600,
  });
  writeFileSync(
    "docs/live-continuity-audit-result.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      completed: true,
      verdict: result.audit.verdict,
      rejected: result.rejected,
    }),
  );
  if (result.audit.verdict !== "contradiction" || !result.rejected)
    process.exitCode = 1;
} finally {
  db.close();
}
