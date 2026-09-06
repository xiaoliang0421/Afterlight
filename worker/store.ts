import {
  nextReset,
  periodKeys,
  type Character,
  type Credits,
  type Episode,
  type Scene,
  type ScenePlan,
  type Settings,
  type Story,
  type Task,
  type TaskState,
} from "../shared/domain";
import { AppError } from "./errors";
import policies from "../shared/policies.json";
import type { OwnerReviewStatus } from "../shared/governance";

export interface TaskRow {
  plan_revision: number;
  preview_lock: string | null;
  owner_review_id: string | null;
  owner_review_status: OwnerReviewStatus | null;
  owner_review_note: string | null;
  generation_mode: "text" | "reference";
  provider_model: string;
  quoted_points: number;
  quoted_reserve_cents: number;
  id: string;
  story_id: string;
  user_id: string;
  author: string;
  prompt_original: string;
  requested_character_ids_json: string;
  plan_json: string | null;
  approved_plan_json: string | null;
  base_version: number;
  queue_sequence: number | null;
  status: TaskState;
  reason: string;
  provider_request_id: string | null;
  provider_attempt_id: string | null;
  provider_status_url: string | null;
  provider_result_url: string | null;
  media_key: string | null;
  captions_key: string | null;
  stream_id: string | null;
  media_duration_ms: number | null;
  media_ready: number;
  reservation_active: number;
  reserved_cents: number;
  recorded_cost_cents: number;
  workflow_id: string | null;
  created_at: number;
  updated_at: number;
}
const storySelect = `SELECT s.id,s.slug,s.owner_id AS ownerId,s.title,s.logline,s.genre,s.world_rules AS worldRules,s.visual_style AS visualStyle,s.status,s.version,s.cover_url AS coverUrl,s.fixture,s.created_at AS createdAt,s.updated_at AS updatedAt,
 (SELECT COUNT(*) FROM scenes WHERE story_id=s.id AND hidden=0) AS sceneCount,
 (SELECT COUNT(*) FROM episodes WHERE story_id=s.id) AS episodeCount,
 COALESCE((SELECT SUM(duration_ms) FROM scenes WHERE story_id=s.id),0) AS durationMs,
 (SELECT COUNT(*) FROM tasks WHERE story_id=s.id AND reservation_active=1) AS queueCount FROM stories s`;
export async function listStories(env: Cloudflare.Env, owner?: string) {
  const result = owner
    ? await env.DB.prepare(
        storySelect +
          " WHERE s.status!='draft' OR s.owner_id=? ORDER BY s.updated_at DESC",
      )
        .bind(owner)
        .all<Story>()
    : await env.DB.prepare(
        storySelect + " WHERE s.status!='draft' ORDER BY s.updated_at DESC",
      ).all<Story>();
  return result.results.map((s) => ({ ...s, fixture: !!s.fixture }));
}
export async function getStory(
  env: Cloudflare.Env,
  id: string,
): Promise<Story> {
  const s = await env.DB.prepare(storySelect + " WHERE s.id=? OR s.slug=?")
    .bind(id, id)
    .first<Story>();
  if (!s)
    throw new AppError("not_found", "This story could not be found.", 404);
  return { ...s, fixture: !!s.fixture };
}
export async function getCharacters(
  env: Cloudflare.Env,
  storyId: string,
  throughVersion = Number.MAX_SAFE_INTEGER,
): Promise<Character[]> {
  return (
    await env.DB.prepare(
      "SELECT id,story_id AS storyId,name,description,state,reference_image AS referenceImage,introduced_version AS introducedVersion FROM characters WHERE story_id=? AND introduced_version<=? ORDER BY introduced_version,id",
    )
      .bind(storyId, throughVersion)
      .all<Character>()
  ).results;
}
export async function getEpisodes(
  env: Cloudflare.Env,
  storyId: string,
): Promise<Episode[]> {
  return (
    await env.DB.prepare(
      "SELECT id,story_id AS storyId,number,title,status,duration_ms AS durationMs FROM episodes WHERE story_id=? ORDER BY number",
    )
      .bind(storyId)
      .all<Episode>()
  ).results;
}
export async function getScenes(
  env: Cloudflare.Env,
  storyId: string,
): Promise<Scene[]> {
  const rows = (
    await env.DB.prepare(
      `SELECT s.id,s.story_id AS storyId,s.episode_id AS episodeId,s.version,s.title,s.summary,s.media_key AS mediaKey,s.stream_id AS streamId,s.thumbnail_url AS thumbnailUrl,s.duration_ms AS durationMs,s.start_ms AS startMs,s.prompt_original AS prompt,s.english_prompt AS englishPrompt,u.display_name AS author,s.author_id AS authorId,s.source,s.fixture,s.published_at AS publishedAt,s.hidden FROM scenes s JOIN users u ON u.id=s.author_id WHERE s.story_id=? ORDER BY s.version`,
    )
      .bind(storyId)
      .all<Scene & { mediaKey: string; streamId: string | null }>()
  ).results;
  return rows.map(({ mediaKey: _key, streamId, ...s }) => ({
    ...s,
    ...(s.hidden
      ? {
          title: "Scene unavailable",
          summary: "",
          prompt: "",
          englishPrompt: "",
        }
      : {}),
    author: s.author || "Storyteller",
    fixture: !!s.fixture,
    hidden: !!s.hidden,
    mediaUrl: s.hidden
      ? ""
      : streamId
        ? `https://videodelivery.net/${streamId}/manifest/video.m3u8`
        : `/api/scenes/${s.id}/video`,
    captionsUrl: `/api/scenes/${s.id}/captions`,
  }));
}
export async function getTask(
  env: Cloudflare.Env,
  id: string,
): Promise<TaskRow> {
  const row = await env.DB.prepare(
    "SELECT t.*,u.display_name AS author FROM tasks t JOIN users u ON u.id=t.user_id WHERE t.id=?",
  )
    .bind(id)
    .first<TaskRow>();
  if (!row)
    throw new AppError(
      "not_found",
      "This contribution could not be found.",
      404,
    );
  return row;
}
export function taskDto(
  t: TaskRow,
  queuePosition: number | null = null,
  privateView = true,
): Task {
  return {
    generationMode: t.generation_mode ?? "text",
    ownerReview:
      privateView && t.owner_review_id && t.owner_review_status
        ? {
            id: t.owner_review_id,
            status: t.owner_review_status,
            note: t.owner_review_note ?? "",
          }
        : null,
    quotedPoints: t.quoted_points ?? 0,
    id: t.id,
    storyId: t.story_id,
    userId: t.user_id,
    author: t.author || "Storyteller",
    prompt: privateView ? t.prompt_original : "",
    requestedCharacterIds: privateView
      ? JSON.parse(t.requested_character_ids_json ?? "[]")
      : [],
    plan:
      privateView && t.plan_json
        ? (JSON.parse(t.plan_json) as ScenePlan)
        : null,
    status: t.status,
    baseVersion: t.base_version,
    sequence: t.queue_sequence,
    queuePosition,
    reason: privateView ? t.reason : "",
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    sceneId: t.status === "Published" ? t.id : null,
  };
}
export async function getQueue(
  env: Cloudflare.Env,
  storyId: string,
  userId?: string,
): Promise<Task[]> {
  const rows = (
    await env.DB.prepare(
      "SELECT t.*,u.display_name AS author FROM tasks t JOIN users u ON u.id=t.user_id WHERE t.story_id=? AND t.reservation_active=1 ORDER BY t.queue_sequence",
    )
      .bind(storyId)
      .all<TaskRow>()
  ).results;
  return rows.map((t, i) => taskDto(t, i + 1, t.user_id === userId));
}
export async function getSettings(env: Cloudflare.Env): Promise<Settings> {
  const s = await env.DB.prepare(
    `SELECT generation_enabled AS generationEnabled,daily_credits AS dailyCredits,daily_budget_cents AS dailyBudgetCents,monthly_budget_cents AS monthlyBudgetCents,task_reserve_cents AS taskReserveCents,max_queue_per_story AS maxQueuePerStory,max_stories_per_user AS maxStoriesPerUser,policy_version AS policyVersion,balance_cents AS providerBalanceCents,checked_at AS providerCheckedAt,reserved_cents AS providerReservedCents,debited_cents AS providerDebitedCents FROM settings JOIN provider_wallet ON settings.id=provider_wallet.id WHERE settings.id=1`,
  ).first<Settings>();
  if (!s)
    throw new AppError(
      "database_unavailable",
      "The service is being prepared. Please try again shortly.",
      503,
    );
  return { ...s, generationEnabled: !!s.generationEnabled };
}
export async function ensureBudgetRows(
  env: Cloudflare.Env,
  userId: string,
  now = Date.now(),
) {
  const p = periodKeys(now),
    s = await getSettings(env);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO credit_accounts(user_id,period,limit_units) VALUES(?,?,?)",
    ).bind(userId, p.day, s.dailyCredits),
    env.DB.prepare(
      "INSERT OR IGNORE INTO budget_periods(kind,period,limit_cents) VALUES('day',?,?)",
    ).bind(p.day, s.dailyBudgetCents),
    env.DB.prepare(
      "INSERT OR IGNORE INTO budget_periods(kind,period,limit_cents) VALUES('month',?,?)",
    ).bind(p.month, s.monthlyBudgetCents),
  ]);
  return { ...p, settings: s };
}
export async function getCredits(
  env: Cloudflare.Env,
  userId: string,
): Promise<Credits> {
  const { day } = await ensureBudgetRows(env, userId);
  const r = await env.DB.prepare(
    "SELECT limit_units,reserved,spent FROM credit_accounts WHERE user_id=? AND period=?",
  )
    .bind(userId, day)
    .first<{ limit_units: number; reserved: number; spent: number }>();
  return {
    available: Math.max(
      0,
      (r?.limit_units ?? 0) - (r?.reserved ?? 0) - (r?.spent ?? 0),
    ),
    reserved: r?.reserved ?? 0,
    spent: r?.spent ?? 0,
    limit: r?.limit_units ?? 0,
    resetsAt: nextReset(),
  };
}
export async function acceptTask(env: Cloudflare.Env, t: TaskRow) {
  if (!t.plan_json)
    throw new AppError("plan_required", "Preview your scene first.", 409);
  const plan = JSON.parse(t.plan_json) as ScenePlan;
  if (plan.rejected)
    throw new AppError(
      "idea_rejected",
      plan.reason || "This idea cannot be generated.",
      409,
    );
  const { day, month, settings } = await ensureBudgetRows(env, t.user_id);
  const r = await env.DB.prepare(
    "UPDATE tasks SET status='Queued',approved_plan_json=plan_json,quota_period=?,budget_day=?,budget_month=?,reserved_cents=?,policy_version=?,terms_version=?,attribution_accepted_at=?,attribution_plan_version=?,workflow_id=NULL,reason='',updated_at=? WHERE id=? AND updated_at=? AND preview_lock IS NULL AND status IN ('Draft','NeedsReview') AND provider_request_id IS NULL AND provider_attempt_id IS NULL RETURNING id",
  )
    .bind(
      day,
      day,
      month,
      t.quoted_reserve_cents || settings.taskReserveCents,
      t.generation_mode === "reference"
        ? "paid-reference-v1"
        : settings.policyVersion,
      policies.version,
      Date.now(),
      t.updated_at,
      Date.now(),
      t.id,
      t.updated_at,
    )
    .first();
  if (!r)
    throw new AppError(
      "task_changed",
      "This contribution has already moved to another stage.",
      409,
    );
}
export async function transition(
  env: Cloudflare.Env,
  taskId: string,
  from: TaskState[],
  to: TaskState,
  reason = "",
) {
  const placeholders = from.map(() => "?").join(",");
  const r = await env.DB.prepare(
    `UPDATE tasks SET status=?,reason=?,updated_at=? WHERE id=? AND status IN (${placeholders}) RETURNING id`,
  )
    .bind(to, reason, Date.now(), taskId, ...from)
    .first();
  return !!r;
}
export async function audit(
  env: Cloudflare.Env,
  actorId: string | null,
  action: string,
  targetId: string,
  detail: object = {},
) {
  await env.DB.prepare("INSERT INTO audit_log VALUES(?,?,?,?,?,?)")
    .bind(
      crypto.randomUUID(),
      actorId,
      action,
      targetId,
      JSON.stringify(detail),
      Date.now(),
    )
    .run();
}
