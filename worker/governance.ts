import { Hono } from "hono";
import { z } from "zod";
import {
  needsOwnerReview,
  type OwnerReviewItem,
  type OwnerReviewStatus,
} from "../shared/governance";
import type { ScenePlan } from "../shared/domain";
import { requireUser, rateLimit, type AppEnv } from "./auth";
import { AppError } from "./errors";
import { getTask, getStory, taskDto, type TaskRow } from "./store";

export async function hasOwnerApproval(env: Cloudflare.Env, task: TaskRow) {
  if (!needsOwnerReview(task.plan_json ? JSON.parse(task.plan_json) : null))
    return true;
  return !!(await env.DB.prepare(
    `SELECT r.id FROM owner_reviews r JOIN stories s ON s.id=r.story_id
    WHERE r.task_id=? AND r.plan_revision=? AND r.plan_json=? AND r.base_version=?
    AND s.version=r.base_version AND r.status='approved' AND r.decided_by=s.owner_id`,
  )
    .bind(task.id, task.plan_revision, task.plan_json, task.base_version)
    .first());
}
export async function assertOwnerApproval(env: Cloudflare.Env, task: TaskRow) {
  if (!(await hasOwnerApproval(env, task)))
    throw new AppError(
      "owner_approval_required",
      "This plan needs the story creator’s approval before it can enter generation.",
      409,
    );
}

export const governance = new Hono<AppEnv>();
governance.post("/tasks/:id/owner-review", async (c) => {
  const user = requireUser(c, true),
    task = await getTask(c.env, c.req.param("id"));
  if (task.user_id !== user.id)
    throw new AppError(
      "forbidden",
      "This contribution belongs to another storyteller.",
      403,
    );
  const input = z
    .object({ planUpdatedAt: z.number(), shareWithOwner: z.literal(true) })
    .parse(await c.req.json());
  if (
    !task.plan_json ||
    !needsOwnerReview(JSON.parse(task.plan_json)) ||
    JSON.parse(task.plan_json).rejected
  )
    throw new AppError(
      "owner_review_changed",
      "Prepare an eligible major-change proposal before requesting a decision.",
      409,
    );
  if (!["Draft", "NeedsReview"].includes(task.status) || task.preview_lock)
    throw new AppError(
      "owner_review_changed",
      "This plan is no longer available for a story-change request.",
      409,
    );
  const previous = await c.env.DB.prepare(
    "SELECT id,status FROM owner_reviews WHERE task_id=? AND plan_revision=?",
  )
    .bind(task.id, task.plan_revision)
    .first<{ id: string; status: string }>();
  if (previous && ["pending", "approved"].includes(previous.status))
    return c.json({ task: taskDto(task) });
  if (previous)
    throw new AppError(
      "owner_review_changed",
      "This version already has a decision. Prepare an updated plan or propose another idea.",
      409,
    );
  if (input.planUpdatedAt !== task.updated_at)
    throw new AppError(
      "plan_changed",
      "Refresh and review the latest plan before sharing it.",
      409,
    );
  await rateLimit(c.env, `owner-request:${user.id}`, 3);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO owner_reviews(id,task_id,story_id,requester_id,plan_revision,plan_json,base_version,created_at)
    VALUES(?,?,?,?,?,?,?,?)`,
  )
    .bind(
      id,
      task.id,
      task.story_id,
      user.id,
      task.plan_revision,
      task.plan_json,
      task.base_version,
      Date.now(),
    )
    .run();
  return c.json({ task: taskDto(await getTask(c.env, task.id)) });
});

type ReviewRow = {
  id: string;
  taskId: string;
  storyId: string;
  storyTitle: string;
  storySlug: string;
  worldRules: string;
  contextVersion: number;
  latestSummary: string | null;
  castJson: string;
  authorId: string;
  author: string;
  prompt: string;
  planJson: string;
  baseVersion: number;
  status: OwnerReviewStatus;
  note: string;
  createdAt: number;
  decidedAt: number | null;
};
governance.get("/owner-reviews", async (c) => {
  const user = requireUser(c);
  const storyId = c.req.query("storyId");
  if (storyId && (await getStory(c.env, storyId)).ownerId !== user.id)
    throw new AppError(
      "forbidden",
      "Only this story’s creator can read these proposals.",
      403,
    );
  const result = await c.env.DB.prepare(
    `SELECT r.id,r.task_id AS taskId,r.story_id AS storyId,s.title AS storyTitle,s.slug AS storySlug,
    r.requester_id AS authorId,u.display_name AS author,t.prompt_original AS prompt,r.plan_json AS planJson,r.base_version AS baseVersion,
    r.status,r.note,r.created_at AS createdAt,r.decided_at AS decidedAt,s.world_rules AS worldRules,s.version AS contextVersion,
    (SELECT summary FROM scenes WHERE story_id=s.id AND hidden=0 ORDER BY version DESC LIMIT 1) AS latestSummary,
    (SELECT json_group_array(json_object('id',ch.id,'name',ch.name,'description',ch.description,'state',ch.state)) FROM characters ch
     WHERE ch.story_id=s.id AND ch.id IN (SELECT value FROM json_each(r.plan_json,'$.characterIds'))) AS castJson
    FROM owner_reviews r JOIN stories s ON s.id=r.story_id JOIN tasks t ON t.id=r.task_id JOIN users u ON u.id=r.requester_id
    WHERE s.owner_id=? AND (? IS NULL OR r.story_id=?) ORDER BY (r.status='pending') DESC,r.created_at DESC LIMIT 100`,
  )
    .bind(user.id, storyId ?? null, storyId ?? null)
    .all<ReviewRow>();
  const reviews: OwnerReviewItem[] = result.results.map(
    ({ planJson, castJson, ...row }) => ({
      ...row,
      plan: JSON.parse(planJson) as ScenePlan,
      cast: JSON.parse(castJson),
    }),
  );
  return c.json({ reviews });
});
governance.post("/owner-reviews/:id/decision", async (c) => {
  const user = requireUser(c, true);
  const row = await c.env.DB.prepare(
    "SELECT r.*,s.owner_id FROM owner_reviews r JOIN stories s ON s.id=r.story_id WHERE r.id=?",
  )
    .bind(c.req.param("id"))
    .first<{
      id: string;
      task_id: string;
      status: string;
      owner_id: string;
      note: string;
    }>();
  if (!row || row.owner_id !== user.id)
    throw new AppError(
      "not_found",
      "This story-change request is not available.",
      404,
    );
  const input = z
    .object({
      decision: z.enum(["approved", "rejected"]),
      note: z.string().trim().min(10).max(1200),
      reviewedPlan: z.literal(true),
    })
    .parse(await c.req.json());
  if (row.status === input.decision && row.note === input.note)
    return c.json({ ok: true });
  if (row.status !== "pending")
    throw new AppError(
      "owner_review_changed",
      "This proposal already has a decision or is no longer current. Refresh the inbox.",
      409,
    );
  const now = Date.now();
  const changed = await c.env.DB.prepare(
    "UPDATE owner_reviews SET status=?,note=?,decided_by=?,decided_at=? WHERE id=? AND status='pending' RETURNING id",
  )
    .bind(input.decision, input.note, user.id, now, row.id)
    .first();
  if (!changed)
    throw new AppError(
      "owner_review_changed",
      "This proposal changed. Refresh the inbox.",
      409,
    );
  return c.json({ ok: true });
});
