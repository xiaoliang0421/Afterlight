import { Hono } from "hono";
import { requireContributor } from "./community";
import { z } from "zod";
import { requireUser, rateLimit, isDevelopment, type AppEnv } from "./auth";
import { AppError } from "./errors";
import { getStory, getTask, getCharacters, taskDto } from "./store";
import { generationOffer } from "./billing";
import { serveR2, probeUploadedMedia } from "./media";
import { validatePlan, type ScenePlan } from "../shared/domain";
import {
  MAX_UPLOAD_BYTES,
  proposalInput,
  uploadInput,
} from "../shared/production";
import policies from "../shared/policies.json";

export const production = new Hono<AppEnv>();
const proposalSelect = `SELECT p.id,p.story_id AS storyId,p.author_id AS authorId,u.display_name AS author,p.prompt,
 p.base_version AS baseVersion,p.status,p.selected_task_id AS taskId,p.created_at AS createdAt
 FROM story_proposals p JOIN users u ON u.id=p.author_id`;

production.get("/stories/:id/proposals", async (c) => {
  const user = requireUser(c),
    story = await getStory(c.env, c.req.param("id"));
  const rows = await c.env.DB.prepare(
    proposalSelect +
      " WHERE p.story_id=? AND (?=1 OR p.author_id=?) ORDER BY p.created_at DESC LIMIT 100",
  )
    .bind(story.id, Number(story.ownerId === user.id), user.id)
    .all();
  return c.json({ proposals: rows.results });
});
production.get("/proposals", async (c) => {
  const user = requireUser(c);
  return c.json({
    proposals: (
      await c.env.DB.prepare(
        proposalSelect +
          " WHERE p.author_id=? ORDER BY p.created_at DESC LIMIT 100",
      )
        .bind(user.id)
        .all()
    ).results,
  });
});
production.post("/stories/:id/proposals", async (c) => {
  const user = requireUser(c, true),
    story = await getStory(c.env, c.req.param("id"));
  if (story.status !== "open")
    throw new AppError(
      "story_paused",
      "This story is not accepting proposals.",
      409,
    );
  const input = proposalInput.parse(await c.req.json());
  if (input.termsVersion !== policies.version)
    throw new AppError(
      "terms_changed",
      "Review the current contribution terms before sharing your proposal.",
      409,
    );
  const prior = await c.env.DB.prepare(
    "SELECT id,prompt,story_id FROM story_proposals WHERE author_id=? AND idempotency_key=?",
  )
    .bind(user.id, input.idempotencyKey)
    .first<{ id: string; prompt: string; story_id: string }>();
  if (prior) {
    if (prior.prompt !== input.prompt || prior.story_id !== story.id)
      throw new AppError(
        "idempotency_conflict",
        "This submission key already belongs to another proposal.",
        409,
      );
    return c.json({ id: prior.id });
  }
  await rateLimit(c.env, `proposal:${user.id}`, 5, 3600000);
  const id = crypto.randomUUID(),
    now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO story_proposals(id,story_id,author_id,prompt,base_version,idempotency_key,terms_version,attribution_accepted_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(author_id,idempotency_key) DO NOTHING`,
  )
    .bind(
      id,
      story.id,
      user.id,
      input.prompt,
      story.version,
      input.idempotencyKey,
      policies.version,
      now,
      now,
      now,
    )
    .run();
  const saved = await c.env.DB.prepare(
    "SELECT id,prompt,story_id FROM story_proposals WHERE author_id=? AND idempotency_key=?",
  )
    .bind(user.id, input.idempotencyKey)
    .first<{ id: string; prompt: string; story_id: string }>();
  if (!saved || saved.prompt !== input.prompt || saved.story_id !== story.id)
    throw new AppError(
      "idempotency_conflict",
      "This submission key already belongs to another proposal.",
      409,
    );
  return c.json({ id: saved.id }, saved.id === id ? 201 : 200);
});
production.post("/proposals/:id/decision", async (c) => {
  const user = requireUser(c),
    { action } = z
      .object({ action: z.enum(["withdraw", "decline"]) })
      .parse(await c.req.json());
  const changed = await c.env.DB.prepare(
    `UPDATE story_proposals SET status=?,updated_at=? WHERE id=? AND status='pending'
   AND ((?='withdraw' AND author_id=?) OR (?='decline' AND EXISTS(SELECT 1 FROM stories s WHERE s.id=story_proposals.story_id AND s.owner_id=?))) RETURNING id`,
  )
    .bind(
      action === "withdraw" ? "withdrawn" : "declined",
      Date.now(),
      c.req.param("id"),
      action,
      user.id,
      action,
      user.id,
    )
    .first();
  if (!changed)
    throw new AppError(
      "proposal_changed",
      "This proposal has already been selected, or you cannot change it.",
      409,
    );
  return c.json({ ok: true });
});

production.post("/stories/:id/uploads", async (c) => {
  const user = requireUser(c, true),
    story = await getStory(c.env, c.req.param("id"));
  if (story.ownerId !== user.id)
    throw new AppError(
      "upload_owner_required",
      "Only the story host can upload a finished scene.",
      403,
    );
  if (!(await generationOffer(c.env)).uploadsEnabled)
    throw new AppError(
      "uploads_disabled",
      "Finished-video uploads are not open yet.",
      409,
    );
  const input = uploadInput.parse(await c.req.json());
  const proposalIds = JSON.stringify([...input.proposalIds].sort());
  const characters = await getCharacters(c.env, story.id, story.version);
  const plan: ScenePlan = {
    title: input.title,
    summary: input.summary,
    englishPrompt: input.summary,
    bridge: input.bridge,
    videoPrompt: input.summary.padEnd(20, " "),
    language: "en",
    durationSeconds: 10,
    characterIds: input.characterIds,
    newCharacters: input.newCharacters,
    proposedEvents: input.events,
    characterUpdates: [],
    requiresReview: false,
    majorChanges: [],
    reason:
      "Host-supplied finished video. Review the actual footage before publication.",
    rejected: false,
  };
  validatePlan(plan, characters);
  const prior = await c.env.DB.prepare(
    "SELECT id,story_id,source_kind,plan_json,upload_bytes,proposal_ids_json FROM tasks WHERE user_id=? AND idempotency_key=?",
  )
    .bind(user.id, input.idempotencyKey)
    .first<{
      id: string;
      story_id: string;
      source_kind: string;
      plan_json: string;
      upload_bytes: number;
      proposal_ids_json: string;
    }>();
  if (prior) {
    const old = JSON.parse(prior.plan_json);
    if (
      prior.story_id !== story.id ||
      prior.source_kind !== "upload" ||
      prior.upload_bytes !== input.bytes ||
      prior.proposal_ids_json !== proposalIds ||
      JSON.stringify({ ...old, durationSeconds: 10 }) !== JSON.stringify(plan)
    )
      throw new AppError(
        "idempotency_conflict",
        "This upload key already belongs to a different scene.",
        409,
      );
    return c.json({ task: taskDto(await getTask(c.env, prior.id)) });
  }
  await rateLimit(c.env, `upload-create:${user.id}`, 6, 3600000);
  const pending = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM tasks WHERE user_id=? AND source_kind='upload' AND status NOT IN ('Published','Cancelled','Failed')",
  )
    .bind(user.id)
    .first<{ n: number }>();
  if ((pending?.n ?? 0) >= 3)
    throw new AppError(
      "upload_limit",
      "Finish or withdraw an existing upload before starting another.",
      409,
    );
  const id = crypto.randomUUID(),
    now = Date.now();
  let insertError: unknown;
  try {
    await c.env.DB.prepare(
      `INSERT INTO tasks(id,story_id,user_id,prompt_original,base_version,idempotency_key,created_at,updated_at,source_kind,billing_kind,proposal_ids_json,upload_bytes,upload_rights_accepted_at,plan_json,requested_character_ids_json)
   VALUES(?,?,?,?,?,?,?,?,'upload','upload',?,?,?,?,?) ON CONFLICT(user_id,idempotency_key) DO NOTHING`,
    )
      .bind(
        id,
        story.id,
        user.id,
        input.summary,
        story.version,
        input.idempotencyKey,
        now,
        now,
        proposalIds,
        input.bytes,
        now,
        JSON.stringify(plan),
        JSON.stringify(input.characterIds),
      )
      .run();
  } catch (error) {
    insertError = error;
  }
  const saved = await c.env.DB.prepare(
    "SELECT id,story_id,source_kind,plan_json,upload_bytes,proposal_ids_json FROM tasks WHERE user_id=? AND idempotency_key=?",
  )
    .bind(user.id, input.idempotencyKey)
    .first<{
      id: string;
      story_id: string;
      source_kind: string;
      plan_json: string;
      upload_bytes: number;
      proposal_ids_json: string;
    }>();
  if (!saved && insertError) throw insertError;
  if (
    !saved ||
    saved.story_id !== story.id ||
    saved.source_kind !== "upload" ||
    saved.upload_bytes !== input.bytes ||
    saved.proposal_ids_json !== proposalIds ||
    JSON.stringify({ ...JSON.parse(saved.plan_json), durationSeconds: 10 }) !==
      JSON.stringify(plan)
  )
    throw new AppError(
      "idempotency_conflict",
      "This upload key already belongs to a different scene.",
      409,
    );
  return c.json(
    { task: taskDto(await getTask(c.env, saved.id)) },
    saved.id === id ? 201 : 200,
  );
});

async function ownUpload(
  c: Parameters<typeof requireUser>[0],
  creating = true,
) {
  const user = creating ? await requireContributor(c, true) : requireUser(c),
    task = await getTask(c.env, c.req.param("id")!);
  if (task.user_id !== user.id || task.source_kind !== "upload")
    throw new AppError("not_found", "Upload not found.", 404);
  if ((await getStory(c.env, task.story_id)).ownerId !== user.id)
    throw new AppError(
      "upload_owner_required",
      "Only the story host can manage this upload.",
      403,
    );
  return task;
}
production.put("/production/:id/file", async (c) => {
  const task = await ownUpload(c);
  if (!(await generationOffer(c.env)).uploadsEnabled)
    throw new AppError(
      "uploads_disabled",
      "Uploads are currently paused.",
      409,
    );
  if (task.media_ready) return c.json({ task: taskDto(task) });
  if (task.status !== "Draft")
    throw new AppError(
      "task_changed",
      "This upload is already being processed.",
      409,
    );
  const length = Number(c.req.header("Content-Length"));
  if (
    !c.req.raw.body ||
    c.req.header("Content-Type") !== "video/mp4" ||
    !Number.isSafeInteger(length) ||
    length !== task.upload_bytes ||
    length > MAX_UPLOAD_BYTES
  )
    throw new AppError(
      "invalid_upload",
      "Upload the declared MP4 file, up to 64 MiB.",
      400,
    );
  await rateLimit(c.env, `upload-file:${task.user_id}`, 12, 3600000);
  const id = crypto.randomUUID(),
    now = Date.now(),
    key = `stories/${task.story_id}/tasks/${task.id}/uploads/${id}.mp4`;
  const claimed = await c.env.DB.prepare(
    "UPDATE tasks SET upload_lock=?,upload_locked_at=? WHERE id=? AND status='Draft' AND media_ready=0 AND (upload_lock IS NULL OR upload_locked_at<?) RETURNING id",
  )
    .bind(id, now, task.id, now - 120000)
    .first();
  if (!claimed)
    throw new AppError(
      "upload_in_progress",
      "An upload is still in progress. Wait before retrying.",
      409,
    );
  try {
    await c.env.DB.prepare("INSERT INTO upload_attempts VALUES(?,?,?,?,NULL)")
      .bind(id, task.id, key, now + 3600000)
      .run();
    await c.env.MEDIA.put(key, c.req.raw.body, {
      httpMetadata: { contentType: "video/mp4" },
    });
    const duration = await probeUploadedMedia(c.env, key, length);
    const plan = {
      ...JSON.parse(task.plan_json!),
      durationSeconds: duration / 1000,
    };
    const changed = await c.env.DB.prepare(
      "UPDATE tasks SET media_key=?,media_duration_ms=?,media_ready=1,plan_json=?,upload_lock=NULL,updated_at=? WHERE id=? AND status='Draft' AND upload_lock=? RETURNING id",
    )
      .bind(key, duration, JSON.stringify(plan), Date.now(), task.id, id)
      .first();
    if (!changed)
      throw new AppError(
        "task_changed",
        "The scene changed during upload. Refresh your contributions.",
        409,
      );
    return c.json({ task: taskDto(await getTask(c.env, task.id)) });
  } finally {
    await c.env.DB.prepare(
      "UPDATE tasks SET upload_lock=NULL WHERE id=? AND upload_lock=?",
    )
      .bind(task.id, id)
      .run();
  }
});
production.post("/production/:id/review-continuity", async (c) => {
  const task = await ownUpload(c),
    { version, continuityAccepted } = z
      .object({
        version: z.number().int().nonnegative(),
        continuityAccepted: z.literal(true),
      })
      .parse(await c.req.json());
  const changed = await c.env.DB.prepare(
    "UPDATE tasks SET base_version=?,updated_at=? WHERE id=? AND status IN ('Draft','NeedsReview') AND media_ready=1 AND reservation_active=0 AND (SELECT version FROM stories WHERE id=tasks.story_id)=? RETURNING id",
  )
    .bind(version, Date.now(), task.id, version)
    .first();
  if (!changed || !continuityAccepted)
    throw new AppError(
      "story_version_conflict",
      "Review the current story before continuing.",
      409,
    );
  return c.json({ task: taskDto(await getTask(c.env, task.id)) });
});
production.on(["GET", "HEAD"], "/production/:id/video", async (c) => {
  const user = requireUser(c),
    task = await getTask(c.env, c.req.param("id"));
  if (
    task.user_id !== user.id ||
    !task.media_ready ||
    !task.media_key ||
    ["Failed", "Cancelled"].includes(task.status)
  )
    throw new AppError("not_found", "Private video not found.", 404);
  if (task.media_key.startsWith("fixture:")) {
    if (
      !isDevelopment(c.env) ||
      !(await getStory(c.env, task.story_id)).fixture
    )
      throw new AppError("not_found", "Private video not found.", 404);
    return c.env.ASSETS.fetch(
      new Request(
        new URL(
          task.story_id === "quiet-orbit"
            ? "/samples/orbit.mp4"
            : "/samples/playback.mp4",
          c.req.url,
        ),
        { method: c.req.method, headers: c.req.raw.headers },
      ),
    );
  }
  return serveR2(c.env, task.media_key, c.req.raw, "video/mp4");
});

export async function cleanupUploads(env: Cloudflare.Env) {
  const rows = await env.DB.prepare(
    `SELECT a.id,a.object_key FROM upload_attempts a WHERE a.deleted_at IS NULL AND a.expires_at<?
   AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.media_key=a.object_key AND t.status NOT IN ('Failed','Cancelled'))
   AND NOT EXISTS(SELECT 1 FROM scenes s WHERE s.media_key=a.object_key) LIMIT 50`,
  )
    .bind(Date.now())
    .all<{ id: string; object_key: string }>();
  for (const row of rows.results) {
    await env.MEDIA.delete(row.object_key);
    await env.DB.prepare("UPDATE upload_attempts SET deleted_at=? WHERE id=?")
      .bind(Date.now(), row.id)
      .run();
  }
}
