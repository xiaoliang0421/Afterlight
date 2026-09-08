import { Hono } from "hono";
import { moderation } from "./moderation";
import { z } from "zod";
import { isDevelopment, requireAdmin, type AppEnv } from "./auth";
import { AppError } from "./errors";
import {
  audit,
  getCharacters,
  getSettings,
  getTask,
  taskDto,
  transition,
  type TaskRow,
} from "./store";
import { serveR2 } from "./media";
import { validatePlan, type ScenePlan } from "../shared/domain";
import { approvedReference, materialSchema } from "./materials";
import { archiveContext, dispatchArchives, type ArchiveRow } from "./archives";
import { validateArchive } from "../shared/archive";
import {
  requireStoppedWorkflow,
  verifyRecoveredRequest,
  scheduleRecovery,
} from "./recovery";
import { operationHealth } from "./operations";
import { accountDeletion } from "./account-deletion";
import { reconcileVideoCost, videoCostInput } from "./video-cost";
import {
  speechDto,
  refreshSpeechCheck,
  startSpeechCheck,
  speechRow,
} from "./speech";

export const admin = new Hono<AppEnv>();
admin.route("/", moderation);
admin.use("*", async (c, next) => {
  requireAdmin(c);
  await next();
});
admin.get("/", async (c) => {
  const [settings, tasks, budgets, reports, logs, ceiling, costs, operations] =
    await Promise.all([
      getSettings(c.env),
      c.env.DB.prepare(
        "SELECT t.*,u.display_name AS author FROM tasks t JOIN users u ON u.id=t.user_id WHERE t.status NOT IN ('Draft','Cancelled') ORDER BY CASE t.status WHEN 'ReconciliationNeeded' THEN 0 WHEN 'NeedsModeration' THEN 1 ELSE 2 END,t.created_at DESC LIMIT 100",
      ).all<TaskRow>(),
      c.env.DB.prepare(
        "SELECT * FROM budget_periods ORDER BY period DESC LIMIT 8",
      ).all(),
      c.env.DB.prepare(
        "SELECT r.*,u.display_name AS author FROM reports r JOIN users u ON u.id=r.user_id ORDER BY created_at DESC LIMIT 50",
      ).all(),
      c.env.DB.prepare(
        "SELECT action,target_id,created_at FROM audit_log ORDER BY created_at DESC LIMIT 30",
      ).all(),
      c.env.DB.prepare(
        "SELECT authorized_spend_cents AS cents FROM settings WHERE id=1",
      ).first<{ cents: number }>(),
      c.env.DB.prepare(
        "SELECT COALESCE(SUM(cents),0) AS cents FROM ledger WHERE kind IN ('consume','release','director-cost-ceiling','speech-cost-ceiling')",
      ).first<{ cents: number }>(),
      operationHealth(c.env),
    ]);
  return c.json({
    operations,
    settings,
    tasks: tasks.results.map((t) => ({
      ...taskDto(t),
      videoUrl: t.media_ready ? `/api/admin/tasks/${t.id}/video` : null,
      recordedCostCents: t.recorded_cost_cents,
      providerRequestId: t.provider_request_id,
      costStatus: t.cost_status,
      reservedCents: t.reserved_cents,
      reservationActive: !!t.reservation_active,
    })),
    budgets: budgets.results,
    reports: reports.results,
    logs: logs.results,
    authorizedSpendCents: ceiling?.cents ?? 0,
    recordedSpendCents: costs?.cents ?? 0,
    readiness: {
      turnstile: !!(c.env.TURNSTILE_SITE_KEY && c.env.TURNSTILE_SECRET_KEY),
      google: !!(
        c.env.GOOGLE_CLIENT_ID &&
        c.env.GOOGLE_CLIENT_SECRET &&
        c.env.BETTER_AUTH_SECRET
      ),
      video: !!c.env.FAL_KEY,
      director: !!c.env.DIRECTOR_API_KEY,
      balance: !!c.env.FAL_ADMIN_KEY,
      stream: !!(c.env.STREAM_API_TOKEN && c.env.STREAM_ACCOUNT_ID),
      liveMode: String(c.env.PROVIDER_MODE) === "live",
    },
  });
});
admin.patch("/settings", async (c) => {
  const input = z
    .object({
      generationEnabled: z.boolean(),
      dailyCredits: z.number().int().min(0).max(50),
      dailyBudgetCents: z.number().int().min(0),
      monthlyBudgetCents: z.number().int().min(0),
      maxQueuePerStory: z.number().int().min(1).max(100),
    })
    .parse(await c.req.json());
  const ceiling = await c.env.DB.prepare(
    "SELECT authorized_spend_cents AS cents FROM settings WHERE id=1",
  ).first<{ cents: number }>();
  if (
    input.dailyBudgetCents > (ceiling?.cents ?? 0) ||
    input.monthlyBudgetCents > (ceiling?.cents ?? 0)
  )
    throw new AppError(
      "authorization_ceiling",
      "The requested budget exceeds the explicitly authorized spending ceiling.",
      409,
    );
  if (input.generationEnabled && String(c.env.PROVIDER_MODE) === "disabled")
    throw new AppError(
      "provider_unavailable",
      "Configure and validate generation before opening the queue.",
      409,
    );
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE settings SET generation_enabled=?,daily_credits=?,daily_budget_cents=?,monthly_budget_cents=?,max_queue_per_story=? WHERE id=1",
    ).bind(
      Number(input.generationEnabled),
      input.dailyCredits,
      input.dailyBudgetCents,
      input.monthlyBudgetCents,
      input.maxQueuePerStory,
    ),
    c.env.DB.prepare(
      "UPDATE budget_periods SET limit_cents=CASE kind WHEN 'day' THEN ? ELSE ? END",
    ).bind(input.dailyBudgetCents, input.monthlyBudgetCents),
  ]);
  await audit(c.env, requireAdmin(c).id, "settings.updated", "platform", input);
  return c.json({ ok: true });
});
admin.post("/balance/refresh", async (c) => {
  await refreshBalance(c.env);
  return c.json({ settings: await getSettings(c.env) });
});
admin.post("/tasks/:id/cost", async (c) => {
  const input = videoCostInput.parse(await c.req.json());
  return c.json(
    await reconcileVideoCost(
      c.env,
      c.req.param("id"),
      requireAdmin(c).id,
      input,
    ),
  );
});
admin.get("/tasks/:id/runtime", async (c) => {
  const task = await getTask(c.env, c.req.param("id"));
  if (!task.workflow_id) return c.json({ status: "not-started" });
  const instance = await c.env.GENERATION.get(task.workflow_id);
  const state = await instance.status();
  return c.json({ status: state.status });
});
admin.on(["GET", "HEAD"], "/tasks/:id/video", async (c) => {
  const t = await getTask(c.env, c.req.param("id"));
  if (!t.media_key || !t.media_ready)
    throw new AppError("not_found", "The video is not ready for review.", 404);
  if (t.media_key.startsWith("fixture:") && isDevelopment(c.env))
    return c.env.ASSETS.fetch(
      new Request(
        new URL(
          t.story_id === "quiet-orbit"
            ? "/samples/orbit.mp4"
            : "/samples/playback.mp4",
          c.req.url,
        ),
        {
          method: c.req.method,
          headers: c.req.raw.headers,
        },
      ),
    );
  return serveR2(c.env, t.media_key, c.req.raw, "video/mp4");
});
admin.post("/tasks/:id/approve", async (c) => {
  const reviewer = requireAdmin(c),
    t = await getTask(c.env, c.req.param("id"));
  if (t.status === "Published") return c.json({ ok: true, sceneId: t.id });
  if (t.status !== "NeedsModeration" || !t.plan_json)
    throw new AppError(
      "task_changed",
      "This scene is not awaiting approval.",
      409,
    );
  const input = z
    .object({
      summary: z.string().trim().min(10).max(1200),
      events: z.array(z.string().trim().min(1).max(400)).max(8),
      englishAudio: z.literal(true),
      englishText: z.literal(true),
      continuity: z.literal(true),
      contentSafe: z.literal(true),
      publicTextReviewed: z.literal(true),
      captions: z.string().max(12000),
      characterUpdates: z
        .array(z.object({ id: z.string(), state: z.string().min(1).max(1200) }))
        .max(3),
      newCharacterIds: z.array(z.string()).max(2),
      noDialogue: z.boolean(),
    })
    .parse(await c.req.json());
  if (!input.noDialogue && !input.captions.startsWith("WEBVTT\n"))
    throw new AppError(
      "captions_required",
      "Add reviewed WebVTT captions matching the actual audio, or confirm that there is no dialogue.",
      409,
    );
  const plan = JSON.parse(t.plan_json) as ScenePlan;
  const newCharacters = plan.newCharacters.filter((ch) =>
    input.newCharacterIds.includes(ch.id),
  );
  if (newCharacters.length !== input.newCharacterIds.length)
    throw new AppError(
      "invalid_character",
      "Only planned candidate characters can be introduced.",
      409,
    );
  validatePlan(
    {
      ...plan,
      newCharacters,
      characterIds: [],
      characterUpdates: input.characterUpdates,
    },
    await getCharacters(c.env, t.story_id),
  );
  const key = `stories/${t.story_id}/tasks/${t.id}/captions.vtt`;
  if (!t.media_key?.startsWith("fixture:"))
    await c.env.MEDIA.put(key, input.noDialogue ? "WEBVTT\n" : input.captions, {
      httpMetadata: { contentType: "text/vtt" },
    });
  await c.env.DB.prepare(
    "UPDATE tasks SET reviewer_id=?,approved_summary=?,approved_events_json=?,approved_characters_json=?,approved_new_characters_json=?,captions_key=?,status='Published',updated_at=? WHERE id=? AND status='NeedsModeration'",
  )
    .bind(
      reviewer.id,
      input.summary,
      JSON.stringify(input.events),
      JSON.stringify(input.characterUpdates),
      JSON.stringify(newCharacters),
      t.media_key?.startsWith("fixture:") ? "fixture:captions" : key,
      Date.now(),
      t.id,
    )
    .run();
  await audit(c.env, reviewer.id, "scene.approved", t.id);
  c.executionCtx.waitUntil(dispatchArchives(c.env));
  await c.env.STORY_ROOMS.getByName(t.story_id).broadcast({
    type: "scene.published",
    storyId: t.story_id,
    sceneId: t.id,
  });
  await c.env.STORY_ROOMS.getByName(t.story_id).kick(t.story_id);
  return c.json({ ok: true, sceneId: t.id });
});
admin.get("/archives", async (c) => {
  const rows = (
    await c.env.DB.prepare(
      "SELECT a.*,s.title AS storyTitle FROM story_archives a JOIN stories s ON s.id=a.story_id ORDER BY a.created_at DESC LIMIT 60",
    ).all<ArchiveRow & { storyTitle: string }>()
  ).results;
  return c.json({
    archives: rows.map((r) => ({
      id: r.id,
      storyId: r.story_id,
      storyTitle: r.storyTitle,
      version: r.version,
      status: r.status,
      reason: r.reason,
      model: r.model,
      context: r.input_json ? JSON.parse(r.input_json) : null,
      draft: r.draft_json ? JSON.parse(r.draft_json) : null,
      approved: r.approved_json ? JSON.parse(r.approved_json) : null,
    })),
  });
});
admin.post("/archives/:id/review", async (c) => {
  const user = requireAdmin(c);
  const input = z
    .object({
      action: z.enum(["approve", "reject"]),
      content: z.unknown().optional(),
      english: z.boolean().optional(),
      sourcesChecked: z.boolean().optional(),
    })
    .parse(await c.req.json());
  const row = await c.env.DB.prepare("SELECT * FROM story_archives WHERE id=?")
    .bind(c.req.param("id"))
    .first<ArchiveRow>();
  if (!row) throw new AppError("not_found", "Archive unavailable.", 404);
  if (!["review", "failed"].includes(row.status))
    throw new AppError(
      "archive_changed",
      "This archive has already been reviewed or is still being prepared.",
      409,
    );
  let content = null;
  if (input.action === "approve") {
    if (!input.english || !input.sourcesChecked)
      throw new AppError(
        "review_required",
        "Confirm English and source review before publication.",
        400,
      );
    // Re-read visible sources at approval time; removal after generation invalidates their citations.
    const context = await archiveContext(c.env, row);
    try {
      content = validateArchive(input.content, context);
    } catch (e) {
      throw new AppError("invalid_archive", (e as Error).message, 400);
    }
    if (content.concerns.length)
      throw new AppError(
        "archive_concerns",
        "Resolve the listed concerns against the source scenes before approval.",
        409,
      );
  }
  const changed = await c.env.DB.prepare(
    "UPDATE story_archives SET status=?,approved_json=?,reviewer_id=?,reviewed_at=? WHERE id=? AND status IN ('review','failed') RETURNING id",
  )
    .bind(
      input.action === "approve" ? "approved" : "rejected",
      content ? JSON.stringify(content) : null,
      user.id,
      Date.now(),
      row.id,
    )
    .first();
  if (!changed)
    throw new AppError(
      "archive_changed",
      "Another reviewer already handled this archive.",
      409,
    );
  if (input.action === "approve")
    await c.env.DB.prepare("UPDATE stories SET updated_at=? WHERE id=?")
      .bind(Date.now(), row.story_id)
      .run();
  await audit(c.env, user.id, `archive.${input.action}`, row.id);
  await c.env.STORY_ROOMS.getByName(row.story_id).broadcast({
    type: "archive.updated",
    storyId: row.story_id,
  });
  return c.json({ ok: true });
});
admin.post("/tasks/:id/reject", async (c) => {
  const t = await getTask(c.env, c.req.param("id"));
  const { reason } = z
    .object({ reason: z.string().trim().min(10).max(600) })
    .parse(await c.req.json());
  if (!(await transition(c.env, t.id, ["NeedsModeration"], "Failed", reason)))
    throw new AppError(
      "task_changed",
      "This task cannot be rejected at its current stage.",
      409,
    );
  await audit(c.env, requireAdmin(c).id, "scene.rejected", t.id);
  await c.env.STORY_ROOMS.getByName(t.story_id).kick(t.story_id);
  return c.json({ ok: true });
});
admin.post("/tasks/:id/resolve", async (c) => {
  const t = await getTask(c.env, c.req.param("id"));
  const input = z
    .object({
      action: z.enum(["fail-confirmed", "resume-known-request"]),
      reason: z.string().min(10).max(600),
      recordedCostCents: z.number().int().nonnegative().optional(),
    })
    .parse(await c.req.json());
  if (t.status !== "ReconciliationNeeded")
    throw new AppError(
      "task_changed",
      "This task is not awaiting reconciliation.",
      409,
    );
  await requireStoppedWorkflow(c.env, t);
  if (input.action === "fail-confirmed") {
    if (input.recordedCostCents === undefined)
      throw new AppError(
        "cost_required",
        "Record the reconciled upstream cost before releasing the reservation.",
        409,
      );
    const changed = await c.env.DB.prepare(
      "UPDATE tasks SET recorded_cost_cents=?,cost_status='reconciled',status='Failed',reason=?,updated_at=? WHERE id=? AND status='ReconciliationNeeded' AND workflow_id IS ? RETURNING id",
    )
      .bind(
        input.recordedCostCents,
        input.reason,
        Date.now(),
        t.id,
        t.workflow_id,
      )
      .first();
    if (!changed)
      throw new AppError(
        "task_changed",
        "Another operator already handled this task.",
        409,
      );
  } else {
    await scheduleRecovery(c.env, t, input.reason);
  }
  await audit(c.env, requireAdmin(c).id, "task.reconciled", t.id, input);
  c.executionCtx.waitUntil(
    c.env.STORY_ROOMS.getByName(t.story_id)
      .kick(t.story_id)
      .catch(() => {
        console.error(
          JSON.stringify({ event: "recovery.dispatch-deferred", taskId: t.id }),
        );
      }),
  );
  return c.json({ ok: true });
});
admin.post("/tasks/:id/recovery", async (c) => {
  const input = z
    .object({
      requestId: z.uuid(),
      confirm: z.boolean().default(false),
      reason: z.string().trim().min(10).max(600),
    })
    .parse(await c.req.json());
  const task = await getTask(c.env, c.req.param("id"));
  if (task.status !== "ReconciliationNeeded")
    throw new AppError(
      "task_changed",
      "This task is not awaiting reconciliation.",
      409,
    );
  await requireStoppedWorkflow(c.env, task);
  const evidence = await verifyRecoveredRequest(c.env, task, input.requestId);
  if (input.confirm) {
    const changed = await c.env.DB.prepare(
      "UPDATE tasks SET provider_request_id=?,provider_status_url=?,provider_result_url=?,reason=?,updated_at=? WHERE id=? AND status='ReconciliationNeeded' AND provider_request_id IS NULL AND provider_attempt_id=? RETURNING id",
    )
      .bind(
        evidence.requestId,
        evidence.statusUrl,
        evidence.resultUrl,
        input.reason,
        Date.now(),
        task.id,
        task.provider_attempt_id,
      )
      .first();
    if (!changed)
      throw new AppError(
        "task_changed",
        "The request has already been linked or the task changed. Refresh its status.",
        409,
      );
    await audit(c.env, requireAdmin(c).id, "task.request-linked", task.id, {
      requestId: evidence.requestId,
      reason: input.reason,
    });
  }
  return c.json({
    requestId: evidence.requestId,
    model: evidence.model,
    sentAt: evidence.sentAt,
    status: evidence.status,
    linked: input.confirm,
  });
});
admin.post("/reports/:id/resolve", async (c) => {
  await c.env.DB.prepare("UPDATE reports SET status='resolved' WHERE id=?")
    .bind(c.req.param("id"))
    .run();
  await audit(c.env, requireAdmin(c).id, "report.resolved", c.req.param("id"));
  return c.json({ ok: true });
});
admin.post("/scenes/:id/hide", async (c) => {
  const { reason } = z
    .object({ reason: z.string().trim().min(10).max(600) })
    .parse(await c.req.json());
  const row = await c.env.DB.prepare(
    "UPDATE scenes SET hidden=1 WHERE id=? RETURNING story_id",
  )
    .bind(c.req.param("id"))
    .first<{ story_id: string }>();
  if (!row) throw new AppError("not_found", "Scene not found.", 404);
  await c.env.DB.prepare(
    "UPDATE stories SET status='paused',publication_hold=1 WHERE id=?",
  )
    .bind(row.story_id)
    .run();
  await audit(c.env, requireAdmin(c).id, "scene.hidden", c.req.param("id"), {
    reason,
  });
  await c.env.STORY_ROOMS.getByName(row.story_id).broadcast({
    type: "story.updated",
    storyId: row.story_id,
  });
  return c.json({ ok: true });
});
admin.patch("/stories/:storyId/characters/:id", async (c) => {
  const input = materialSchema.parse(await c.req.json());
  const image = approvedReference(input.referenceImage),
    voice = input.voiceReference
      ? approvedReference(input.voiceReference)
      : null;
  const r = await c.env.DB.prepare(
    "UPDATE characters SET reference_image=?,voice_reference=?,voice_duration_ms=?,material_version=material_version+1 WHERE story_id=? AND id=? RETURNING id",
  )
    .bind(
      image,
      voice,
      input.voiceDurationMs ?? null,
      c.req.param("storyId"),
      c.req.param("id"),
    )
    .first();
  if (!r)
    throw new AppError(
      "not_found",
      "This character does not belong to this story.",
      404,
    );
  await c.env.DB.prepare(
    "INSERT INTO character_material_versions VALUES(?,?,?,?,?,?,?,?)",
  )
    .bind(
      crypto.randomUUID(),
      c.req.param("storyId"),
      c.req.param("id"),
      image,
      voice,
      input.voiceDurationMs ?? null,
      requireAdmin(c).id,
      Date.now(),
    )
    .run();
  await audit(
    c.env,
    requireAdmin(c).id,
    "character.reference-updated",
    c.req.param("id"),
  );
  return c.json({ ok: true });
});
admin.get("/materials", async (c) => {
  const characters = (
    await c.env.DB.prepare(
      "SELECT c.id,c.story_id AS storyId,s.title AS storyTitle,c.name,c.description,c.reference_image AS referenceImage,c.voice_reference AS voiceReference,c.voice_duration_ms AS voiceDurationMs,c.material_version AS materialVersion FROM characters c JOIN stories s ON s.id=c.story_id ORDER BY s.title,c.name",
    ).all()
  ).results;
  const pending = (
    await c.env.DB.prepare(
      "SELECT t.id AS taskId,t.story_id AS storyId,s.title AS storyTitle,t.plan_json FROM tasks t JOIN stories s ON s.id=t.story_id WHERE t.plan_json IS NOT NULL AND t.status IN ('Draft','NeedsReview','Queued','Preparing') ORDER BY t.created_at DESC LIMIT 100",
    ).all<{
      taskId: string;
      storyId: string;
      storyTitle: string;
      plan_json: string;
    }>()
  ).results;
  const approved = (
    await c.env.DB.prepare(
      "SELECT task_id,character_id,reference_image AS referenceImage,voice_reference AS voiceReference,voice_duration_ms AS voiceDurationMs FROM candidate_materials",
    ).all<{
      task_id: string;
      character_id: string;
      referenceImage: string;
      voiceReference: string | null;
      voiceDurationMs: number | null;
    }>()
  ).results;
  const candidates = pending.flatMap((t) =>
    (JSON.parse(t.plan_json) as ScenePlan).newCharacters.map((ch) => ({
      ...ch,
      referenceImage: "",
      ...approved.find(
        (m) => m.task_id === t.taskId && m.character_id === ch.id,
      ),
      taskId: t.taskId,
      storyId: t.storyId,
      storyTitle: t.storyTitle,
    })),
  );
  return c.json({ characters, candidates });
});
admin.get("/account-requests", async (c) =>
  c.json({
    requests: (
      await c.env.DB.prepare(
        "SELECT r.id,r.kind,r.reason,r.status,r.response,r.created_at AS createdAt,u.id AS userId,u.display_name AS nickname,u.email FROM account_requests r JOIN users u ON u.id=r.user_id WHERE r.status='open' ORDER BY r.created_at",
      ).all()
    ).results,
  }),
);
admin.route("/account-requests", accountDeletion);
admin.put("/tasks/:taskId/materials/:id", async (c) => {
  const task = await getTask(c.env, c.req.param("taskId"));
  if (
    !["Draft", "NeedsReview", "Queued", "Preparing"].includes(task.status) ||
    !task.plan_json
  )
    throw new AppError(
      "task_changed",
      "Materials for this scene can no longer be changed.",
      409,
    );
  const candidate = (
    JSON.parse(task.plan_json) as ScenePlan
  ).newCharacters.find((ch) => ch.id === c.req.param("id"));
  if (!candidate)
    throw new AppError(
      "not_found",
      "This candidate is not part of the current scene plan.",
      404,
    );
  const input = materialSchema.parse(await c.req.json()),
    image = approvedReference(input.referenceImage),
    voice = input.voiceReference
      ? approvedReference(input.voiceReference)
      : null;
  await c.env.DB.prepare(
    "INSERT INTO candidate_materials VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(task_id,character_id) DO UPDATE SET name=excluded.name,description=excluded.description,reference_image=excluded.reference_image,voice_reference=excluded.voice_reference,voice_duration_ms=excluded.voice_duration_ms,approved_by=excluded.approved_by,approved_at=excluded.approved_at",
  )
    .bind(
      task.id,
      candidate.id,
      task.story_id,
      candidate.name,
      candidate.description,
      image,
      voice,
      input.voiceDurationMs ?? null,
      requireAdmin(c).id,
      Date.now(),
    )
    .run();
  await audit(
    c.env,
    requireAdmin(c).id,
    "candidate.material-approved",
    candidate.id,
  );
  return c.json({ ok: true });
});
export async function refreshBalance(env: Cloudflare.Env) {
  if (isDevelopment(env) && String(env.PROVIDER_MODE) === "fixture") {
    await env.DB.prepare("UPDATE provider_wallet SET checked_at=? WHERE id=1")
      .bind(Date.now())
      .run();
    return;
  }
  if (!env.FAL_ADMIN_KEY)
    throw new AppError(
      "balance_key_missing",
      "Configure the fal account billing key to check available balance.",
      503,
    );
  const r = await fetch(
    "https://api.fal.ai/v1/account/billing?expand=credits",
    {
      headers: { Authorization: `Key ${env.FAL_ADMIN_KEY}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!r.ok)
    throw new AppError(
      "balance_check_failed",
      "The provider balance could not be checked. New generation will pause if the last check expires.",
      503,
    );
  const body = z
    .object({
      credits: z.object({
        current_balance: z.number().finite(),
        currency: z.literal("USD"),
      }),
    })
    .parse(await r.json());
  // Retain unreconciled local costs. A later billing snapshot alone does not prove those requests were charged.
  await env.DB.prepare(
    "UPDATE provider_wallet SET balance_cents=?,checked_at=? WHERE id=1",
  )
    .bind(Math.floor(body.credits.current_balance * 100), Date.now())
    .run();
}

// These routes never silently retry a persisted paid speech attempt.
admin.get("/tasks/:id/speech", async (c) =>
  c.json({ check: await speechDto(c.env, c.req.param("id")) }),
);
admin.post("/tasks/:id/speech/start", async (c) => {
  await startSpeechCheck(c.env, c.req.param("id"));
  return c.json({ check: await speechDto(c.env, c.req.param("id")) });
});
admin.post("/tasks/:id/speech/refresh", async (c) => {
  await refreshSpeechCheck(c.env, c.req.param("id"));
  return c.json({ check: await speechDto(c.env, c.req.param("id")) });
});
admin.post("/tasks/:id/speech/close", async (c) => {
  const user = requireAdmin(c);
  const input = z
    .object({
      providerTerminalVerified: z.literal(true),
      note: z.string().trim().min(20).max(1000),
    })
    .strict()
    .parse(await c.req.json());
  const id = c.req.param("id"),
    row = await speechRow(c.env, id);
  if (
    !row ||
    !["uncertain", "queued", "failed"].includes(row.status) ||
    row.created_at > Date.now() - 120000
  )
    throw new AppError(
      "speech_not_ready",
      "Wait for the current attempt and verify its terminal provider state before closing.",
      409,
    );
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE speech_checks SET status='closed',failure_code='closed-after-provider-review',updated_at=? WHERE task_id=? AND status IN ('uncertain','queued','failed')",
    ).bind(Date.now(), id),
    c.env.DB.prepare(
      "INSERT INTO audit_log(id,actor_id,action,target_id,detail,created_at) VALUES(?,?,'speech.closed',?,?,?)",
    ).bind(
      crypto.randomUUID(),
      user.id,
      id,
      JSON.stringify({ note: input.note, costCeilingRetainedCents: 10 }),
      Date.now(),
    ),
  ]);
  return c.json({ check: await speechDto(c.env, id) });
});
