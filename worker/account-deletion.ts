import { Hono } from "hono";
import { z } from "zod";
import { isDevelopment, requireAdmin, type AppEnv } from "./auth";
import { AppError } from "./errors";
import policies from "../shared/policies.json";

export async function deletionPreview(env: Cloudflare.Env, requestId: string) {
  const request = await env.DB.prepare(
    "SELECT r.id,r.status,r.user_id AS userId,u.display_name AS nickname,u.role,u.deleted_at AS deletedAt FROM account_requests r JOIN users u ON u.id=r.user_id WHERE r.id=?",
  )
    .bind(requestId)
    .first<{
      id: string;
      status: string;
      userId: string;
      nickname: string;
      role: string;
      deletedAt: number | null;
    }>();
  if (!request)
    throw new AppError("not_found", "The request was not found.", 404);
  const counts = await env.DB.prepare(
    `SELECT
    (SELECT COUNT(*) FROM tasks WHERE (user_id=? OR story_id IN (SELECT id FROM stories WHERE owner_id=?)) AND (reservation_active=1 OR preview_lock IS NOT NULL OR status IN ('Queued','Preparing','Generating','Checking','NeedsModeration','Packaging','ReconciliationNeeded'))) AS activeTasks,
    (SELECT COUNT(*) FROM speech_checks s JOIN tasks t ON t.id=s.task_id WHERE t.user_id=? AND s.status IN ('submitting','queued','uncertain')) AS activeSpeechChecks,
    (SELECT COUNT(*) FROM payment_orders WHERE user_id=? AND (billing_hold=1 OR status IN ('creating','pending','review'))) +
    (SELECT COUNT(*) FROM paid_credit_accounts WHERE user_id=? AND (balance!=0 OR reserved!=0)) +
    (SELECT COUNT(*) FROM billing_requests WHERE user_id=? AND status='open') AS billingIssues,
    (SELECT COUNT(*) FROM reports WHERE user_id=? AND status='open') AS openReports,
    (SELECT COUNT(*) FROM scenes WHERE author_id=?) AS publishedScenes,
    (SELECT COUNT(*) FROM stories WHERE owner_id=?) AS ownedStories,
    (SELECT COUNT(*) FROM payment_orders WHERE user_id=?) AS retainedOrders`,
  )
    .bind(...Array<string>(10).fill(request.userId))
    .first<{
      activeTasks: number;
      activeSpeechChecks: number;
      billingIssues: number;
      openReports: number;
      publishedScenes: number;
      ownedStories: number;
      retainedOrders: number;
    }>();
  const blockers: string[] = [];
  if (request.status !== "open" || request.deletedAt)
    blockers.push("This request is no longer open.");
  if (request.role === "admin")
    blockers.push("Transfer the studio role before deleting this account.");
  if (
    await env.DB.prepare(
      "SELECT id FROM story_proposals WHERE author_id=? AND status='selected' LIMIT 1",
    )
      .bind(request.userId)
      .first()
  )
    blockers.push(
      "Resolve selected audience proposals before deleting this account.",
    );
  if (counts?.activeTasks)
    blockers.push(
      "Resolve active tasks, previews and uncertain provider requests first, including tasks in this person's stories.",
    );
  if (counts?.activeSpeechChecks)
    blockers.push(
      "Resolve pending or uncertain speech checks before deletion.",
    );
  if (counts?.billingIssues)
    blockers.push(
      "Resolve unfinished orders, payment requests and the purchased-point balance first. Deletion does not issue a refund.",
    );
  if (counts?.openReports)
    blockers.push("Resolve the person's open content reports first.");
  const policyReady = isDevelopment(env) || String(policies.status) === "final";
  if (!policyReady)
    blockers.push(
      "Finalize the retention policy before executing deletion outside local development.",
    );
  return { request, counts, blockers, policyVersion: policies.version };
}

export const accountDeletion = new Hono<AppEnv>();
accountDeletion.use("*", async (c, next) => {
  requireAdmin(c);
  await next();
});
accountDeletion.get("/:id/preview", async (c) =>
  c.json(await deletionPreview(c.env, c.req.param("id"))),
);
accountDeletion.post("/:id/respond", async (c) => {
  const input = z
    .object({ response: z.string().trim().min(10).max(1200) })
    .strict()
    .parse(await c.req.json());
  const row = await c.env.DB.prepare(
    "UPDATE account_requests SET response=?,responded_at=? WHERE id=? AND status='open' RETURNING id",
  )
    .bind(input.response, Date.now(), c.req.param("id"))
    .first();
  if (!row)
    throw new AppError(
      "request_changed",
      "This request is no longer open.",
      409,
    );
  return c.json({ ok: true });
});
accountDeletion.post("/:id/execute", async (c) => {
  const reviewer = requireAdmin(c);
  const input = z
    .object({
      userId: z.string().min(1),
      policyVersion: z.string(),
      reviewedContent: z.literal(true),
      confirm: z.literal("DELETE ACCOUNT"),
    })
    .strict()
    .parse(await c.req.json());
  const existing = await c.env.DB.prepare(
    "SELECT request_id AS requestId,completed_at AS completedAt FROM account_deletions WHERE request_id=? AND user_id=? AND completed_at IS NOT NULL",
  )
    .bind(c.req.param("id"), input.userId)
    .first();
  if (existing) return c.json({ receipt: existing, alreadyCompleted: true });
  const preview = await deletionPreview(c.env, c.req.param("id"));
  if (
    preview.request.userId !== input.userId ||
    input.policyVersion !== policies.version ||
    preview.blockers.length ||
    reviewer.id === input.userId
  )
    throw new AppError(
      "deletion_not_ready",
      preview.blockers[0] ||
        "The account or policy changed. Review the request again.",
      409,
    );
  const now = Date.now();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO account_deletions(request_id,user_id,reviewer_id,policy_version,reviewed_content,created_at) VALUES(?,?,?,?,1,?)",
      ).bind(
        preview.request.id,
        input.userId,
        reviewer.id,
        policies.version,
        now,
      ),
      c.env.DB.prepare(
        "UPDATE users SET deleted_at=? WHERE id=? AND deleted_at IS NULL",
      ).bind(now, input.userId),
    ]);
  } catch {
    throw new AppError(
      "deletion_changed",
      "The account changed or deletion could not commit. No partial database deletion was applied; refresh the review.",
      409,
    );
  }
  return c.json({
    receipt: { requestId: preview.request.id, completedAt: now },
    alreadyCompleted: false,
  });
});

export async function cleanupDeletedAccountMedia(env: Cloudflare.Env) {
  const rows = await env.DB.prepare(
    "SELECT object_key FROM privacy_media_cleanup WHERE completed_at IS NULL ORDER BY queued_at LIMIT 20",
  ).all<{ object_key: string }>();
  for (const row of rows.results) {
    // R2 deletes are idempotent; only exact task object paths queued by the database are accepted.
    if (
      !/^stories\/[^/]+\/tasks\/[^/]+\/(original\.mp4|captions\.vtt)$/.test(
        row.object_key,
      )
    )
      continue;
    const retained = await env.DB.prepare(
      "SELECT 1 FROM scenes WHERE media_key=? OR captions_key=? LIMIT 1",
    )
      .bind(row.object_key, row.object_key)
      .first();
    if (retained) continue;
    await env.MEDIA.delete(row.object_key);
    await env.DB.prepare(
      "UPDATE privacy_media_cleanup SET completed_at=? WHERE object_key=?",
    )
      .bind(Date.now(), row.object_key)
      .run();
  }
}
