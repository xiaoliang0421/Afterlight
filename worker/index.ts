import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { z, ZodError } from "zod";
import { brand } from "../shared/brand";
import {
  promptInputSchema,
  storyInputSchema,
  validatePlan,
  type ScenePlan,
} from "../shared/domain";
import {
  createAuth,
  authConfigured,
  currentUser,
  isDevelopment,
  requireUser,
  requireAdmin,
  rateLimit,
  sha256,
  type AppEnv,
} from "./auth";
import { AppError, normalizeError } from "./errors";
import {
  listStories,
  getStory,
  getCharacters,
  getEpisodes,
  getScenes,
  getQueue,
  getTask,
  taskDto,
  getCredits,
  getSettings,
  acceptTask,
  transition,
  audit,
  type TaskRow,
} from "./store";
import { preparePlan } from "./director";
import { serveR2 } from "./media";
import { selectedMaterials } from "./materials";
import { videoMode } from "./video-policy";
import { generationModels } from "../shared/billing";
import {
  billing,
  generationOffer,
  checkoutConfigured,
  receivePaddleWebhook,
  reconcilePayments,
} from "./billing";
import { sharePage } from "./share";
import { admin, refreshBalance } from "./admin";
import policies from "../shared/policies.json";
import { publicArchive, dispatchArchives } from "./archives";
import { governance, assertOwnerApproval } from "./governance";
import { creationAction } from "../shared/protection";
import { verifyHuman } from "./turnstile";
import { recordedReconciliation } from "./operations";
export { ArchiveWorkflow } from "./archive-workflow";
export { StoryRoom } from "./story-room";
export { GenerationWorkflow } from "./generation";

const app = new Hono<AppEnv>();
// Paddle has its own raw-body signature authentication. Do not apply browser Origin/session checks to this exact route.
app.post("/api/billing/webhook", bodyLimit({ maxSize: 262144 }), async (c) => {
  await receivePaddleWebhook(c.env, c.req.raw);
  c.executionCtx.waitUntil(
    reconcilePayments(c.env).catch(() => {
      console.error(JSON.stringify({ event: "payment.background-deferred" }));
    }),
  );
  return c.json({ received: true });
});
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 32768,
    onError: (c) =>
      c.json(
        {
          error: {
            code: "body_too_large",
            message: "This request is too large.",
          },
        },
        413,
      ),
  }),
);
app.use("/api/*", async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("X-Request-Id", requestId);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Cache-Control", "private, no-store");
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("Origin");
    const allowed = new Set<string>([c.env.PUBLIC_ORIGIN]);
    if (isDevelopment(c.env)) allowed.add("http://127.0.0.1:8788");
    if (!origin || !allowed.has(origin))
      throw new AppError(
        "origin_rejected",
        "This request did not come from this website.",
        403,
      );
    if (!c.req.header("content-type")?.startsWith("application/json"))
      throw new AppError("json_required", "Send this request as JSON.", 400);
  }
  if (!c.req.path.startsWith("/api/auth/")) c.set("user", await currentUser(c));
  const action = creationAction(c.req.path.slice(4), c.req.method);
  if (action) {
    const user = requireUser(c, true);
    await rateLimit(c.env, `creation:${user.id}`, 30);
    const ip = c.req.header("CF-Connecting-IP");
    if (ip)
      await rateLimit(
        c.env,
        `creation-ip:${await sha256(`${new Date().toISOString().slice(0, 10)}:${ip}`)}`,
        60,
      );
    await verifyHuman(c.env, c.req.raw, action);
  }
  await next();
});
app.onError((error, c) => {
  if (error instanceof ZodError)
    return c.json(
      {
        error: {
          code: "invalid_input",
          message:
            error.issues[0]?.message ??
            "Please check the information you entered.",
        },
      },
      400,
    );
  const safe = normalizeError(error);
  console.error(
    JSON.stringify({
      event: "request.error",
      requestId: c.get("requestId"),
      code: safe.code,
      status: safe.status,
    }),
  );
  return c.json(
    {
      error: {
        code: safe.code,
        message: safe.message,
        requestId: c.get("requestId"),
      },
    },
    safe.status,
  );
});
app.get("/api/health", (c) => c.json({ ok: true, service: "afterlight" }));
app.on(["GET", "POST"], "/api/auth/*", (c) =>
  createAuth(c.env).handler(c.req.raw),
);
app.get("/api/bootstrap", async (c) => {
  const user = c.get("user"),
    settings = await getSettings(c.env);
  const [stories, credits, favorites, notifications, offer] = await Promise.all(
    [
      listStories(c.env, user?.id),
      user ? getCredits(c.env, user.id) : null,
      user
        ? c.env.DB.prepare("SELECT story_id FROM favorites WHERE user_id=?")
            .bind(user.id)
            .all<{ story_id: string }>()
        : null,
      user
        ? c.env.DB.prepare(
            "SELECT id,message,story_id AS storyId,task_id AS taskId,created_at AS createdAt,read_at AS readAt FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 30",
          )
            .bind(user.id)
            .all()
        : null,
      generationOffer(c.env),
    ],
  );
  return c.json({
    config: {
      environment: c.env.ENVIRONMENT,
      providerMode: c.env.PROVIDER_MODE,
      development: isDevelopment(c.env),
      canSignIn: authConfigured(c.env) || isDevelopment(c.env),
      turnstileSiteKey: c.env.TURNSTILE_SITE_KEY ?? "",
      generationEnabled:
        settings.generationEnabled && c.env.PROVIDER_MODE !== "disabled",
      paymentsEnabled: checkoutConfigured(c.env) && offer.referenceEnabled,
      referenceEnabled: offer.referenceEnabled,
      referencePoints: offer.referencePoints,
      supportEmail: c.env.SUPPORT_EMAIL,
    },
    user,
    credits,
    stories,
    favorites: favorites?.results.map((x) => x.story_id) ?? [],
    notifications: notifications?.results ?? [],
  });
});
app.post("/api/dev/login", async (c) => {
  if (
    !isDevelopment(c.env) ||
    !["127.0.0.1", "localhost"].includes(new URL(c.req.url).hostname)
  )
    throw new AppError("not_found", "Not found.", 404);
  const { persona } = z
    .object({
      persona: z.enum(["creator", "studio", "newcomer"]).default("creator"),
    })
    .parse(await c.req.json());
  const userId = `dev-${persona}`;
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO users(id,email,display_name,role,created_at) VALUES(?,?,?,?,?)",
  )
    .bind(
      userId,
      `${persona}@example.invalid`,
      persona === "newcomer"
        ? ""
        : persona === "studio"
          ? `${brand.name} Studio`
          : "You",
      persona === "studio" ? "admin" : "user",
      Date.now(),
    )
    .run();
  const token = crypto.randomUUID() + crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO sessions VALUES(?,?,?,?)")
    .bind(await sha256(token), userId, Date.now() + 86400000, Date.now())
    .run();
  setCookie(c, "afterlight-dev", token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 86400,
  });
  return c.json({ ok: true });
});
app.post("/api/logout", async (c) => {
  const user = requireUser(c);
  if (isDevelopment(c.env)) {
    const token = getCookie(c, "afterlight-dev");
    if (token)
      await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash=?")
        .bind(await sha256(token))
        .run();
    deleteCookie(c, "afterlight-dev", { path: "/" });
  } else
    return createAuth(c.env).handler(
      new Request(new URL("/api/auth/sign-out", c.env.PUBLIC_ORIGIN), {
        method: "POST",
        headers: c.req.raw.headers,
        body: "{}",
      }),
    );
  await audit(c.env, user.id, "account.sign-out", user.id);
  return c.json({ ok: true });
});
app.put("/api/account/profile", async (c) => {
  const user = requireUser(c);
  const { nickname } = z
    .object({
      nickname: z
        .string()
        .trim()
        .min(2, "Use at least 2 characters.")
        .max(30, "Use no more than 30 characters.")
        .refine(
          (s) => !/[<>@\r\n\x00-\x1f]/.test(s),
          "Use a public nickname, without an email address or markup.",
        ),
    })
    .parse(await c.req.json());
  await rateLimit(c.env, `profile:${user.id}`, 5);
  const key = nickname.normalize("NFKC").toLocaleLowerCase("en-US");
  if (/[<>@\p{Cf}]/u.test(key) || !/[\p{L}\p{N}]/u.test(key))
    throw new AppError(
      "invalid_nickname",
      "Choose a readable public nickname without an email address or hidden characters.",
      400,
    );
  if (
    user.role !== "admin" &&
    [
      "afterlight",
      "afterlight studio",
      brand.name.toLocaleLowerCase("en-US"),
      `${brand.name} studio`.toLocaleLowerCase("en-US"),
      "admin",
      "administrator",
      "support",
    ].includes(key)
  )
    throw new AppError(
      "nickname_reserved",
      "Choose a personal nickname that does not imply a studio role.",
      409,
    );
  await c.env.DB.prepare(
    "UPDATE users SET display_name=?,nickname_key=? WHERE id=? AND deleted_at IS NULL",
  )
    .bind(nickname, key, user.id)
    .run();
  await audit(c.env, user.id, "profile.updated", user.id);
  return c.json({ ok: true });
});
app.post("/api/account/policies", async (c) => {
  const user = requireUser(c);
  const input = z
    .object({
      version: z.literal(policies.version),
      termsAccepted: z.literal(true),
      privacyAcknowledged: z.literal(true),
    })
    .parse(await c.req.json());
  if (String(c.env.ENVIRONMENT) === "production" && policies.status !== "final")
    throw new AppError(
      "policies_not_ready",
      "Account creation is not open yet.",
      503,
    );
  const snapshot = JSON.stringify(policies);
  await c.env.DB.prepare("INSERT OR IGNORE INTO policy_documents VALUES(?,?,?)")
    .bind(policies.version, snapshot, Date.now())
    .run();
  const archived = await c.env.DB.prepare(
    "SELECT document_json FROM policy_documents WHERE version=?",
  )
    .bind(policies.version)
    .first<{ document_json: string }>();
  if (archived?.document_json !== snapshot)
    throw new AppError(
      "policy_version_conflict",
      "The updated policies need a new version before acceptance can be recorded.",
      409,
    );
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO policy_acceptances(user_id,version,accepted_at,terms_accepted,privacy_acknowledged) VALUES(?,?,?,1,1)",
  )
    .bind(user.id, input.version, Date.now())
    .run();
  return c.json({ ok: true, version: input.version });
});
app.get("/api/account/policies", async (c) => {
  const user = requireUser(c);
  const records = await c.env.DB.prepare(
    "SELECT version,accepted_at AS acceptedAt FROM policy_acceptances WHERE user_id=? ORDER BY accepted_at DESC",
  )
    .bind(user.id)
    .all();
  return c.json({ currentVersion: policies.version, records: records.results });
});
app.get("/api/account/policies/:version", async (c) => {
  const user = requireUser(c);
  const row = await c.env.DB.prepare(
    "SELECT d.document_json FROM policy_documents d JOIN policy_acceptances p ON p.version=d.version WHERE p.user_id=? AND d.version=?",
  )
    .bind(user.id, c.req.param("version"))
    .first<{ document_json: string }>();
  if (!row)
    throw new AppError(
      "not_found",
      "No accepted policy record was found.",
      404,
    );
  const document = JSON.parse(row.document_json) as typeof policies;
  if (c.req.query("download") === "1") {
    const text = [
      `Service policies — ${document.version}`,
      `Operator: ${document.operatorName || "Pending"}`,
      `Contact: ${document.contactEmail || "Pending"}`,
      ...(["privacy", "terms"] as const).flatMap((kind) => [
        kind === "privacy" ? "PRIVACY POLICY" : "TERMS OF SERVICE",
        ...document[kind].flatMap((section) => [
          section.title,
          ...section.paragraphs,
        ]),
      ]),
    ].join("\n\n");
    return new Response(text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": "attachment; filename=accepted-policies.txt",
        "Cache-Control": "no-store",
      },
    });
  }
  return c.json(document);
});
app.get("/api/account/requests", async (c) => {
  const user = requireUser(c);
  return c.json({
    requests: (
      await c.env.DB.prepare(
        "SELECT id,kind,reason,status,created_at AS createdAt FROM account_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 20",
      )
        .bind(user.id)
        .all()
    ).results,
  });
});
app.post("/api/account/requests", async (c) => {
  const user = requireUser(c),
    input = z
      .object({
        kind: z.literal("deletion"),
        reason: z.string().trim().max(1200).default(""),
      })
      .parse(await c.req.json());
  await rateLimit(c.env, `account-request:${user.id}`, 3, 3600000);
  await c.env.DB.prepare(
    "INSERT INTO account_requests(id,user_id,kind,reason,created_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,kind) WHERE status='open' DO NOTHING",
  )
    .bind(crypto.randomUUID(), user.id, input.kind, input.reason, Date.now())
    .run();
  return c.json({ ok: true });
});
app.post("/api/account/requests/:id/cancel", async (c) => {
  const user = requireUser(c);
  await c.env.DB.prepare(
    "UPDATE account_requests SET status='cancelled' WHERE id=? AND user_id=? AND status='open'",
  )
    .bind(c.req.param("id"), user.id)
    .run();
  return c.json({ ok: true });
});
app.get("/api/people/:id", async (c) => {
  const person = await c.env.DB.prepare(
    "SELECT id,display_name AS displayName,created_at AS joinedAt FROM users WHERE id=? AND display_name!=''",
  )
    .bind(c.req.param("id"))
    .first();
  if (!person)
    throw new AppError(
      "not_found",
      "This storyteller could not be found.",
      404,
    );
  const contributions = await c.env.DB.prepare(
    "SELECT s.id,s.title,s.story_id AS storyId,s.episode_id AS episodeId,s.start_ms AS startMs,s.duration_ms AS durationMs,st.slug AS storySlug,st.title AS storyTitle,s.thumbnail_url AS thumbnailUrl FROM scenes s JOIN stories st ON st.id=s.story_id WHERE s.author_id=? AND s.hidden=0 ORDER BY s.published_at DESC LIMIT 100",
  )
    .bind(c.req.param("id"))
    .all();
  return c.json({ person, contributions: contributions.results });
});
app.get("/api/stories", async (c) =>
  c.json({ stories: await listStories(c.env, c.get("user")?.id) }),
);
app.get("/api/stories/:id", async (c) => {
  const story = await getStory(c.env, c.req.param("id")),
    user = c.get("user");
  if (
    story.status === "draft" &&
    story.ownerId !== user?.id &&
    user?.role !== "admin"
  )
    throw new AppError("not_found", "This story is not open yet.", 404);
  const [characters, episodes, scenes, queue, progress] = await Promise.all([
    getCharacters(c.env, story.id),
    getEpisodes(c.env, story.id),
    getScenes(c.env, story.id),
    getQueue(c.env, story.id, user?.id),
    user
      ? c.env.DB.prepare(
          "SELECT episode_id AS episodeId,time_ms AS timeMs,updated_at AS updatedAt FROM watch_progress WHERE user_id=? AND story_id=?",
        )
          .bind(user.id, story.id)
          .first()
      : null,
  ]);
  return c.json({ story, characters, episodes, scenes, queue, progress });
});
app.get("/api/stories/:id/archive", async (c) => {
  const story = await getStory(c.env, c.req.param("id")),
    user = c.get("user");
  if (
    story.status === "draft" &&
    story.ownerId !== user?.id &&
    user?.role !== "admin"
  )
    throw new AppError("not_found", "This story is not open yet.", 404);
  const version = z.coerce
    .number()
    .int()
    .min(0)
    .max(story.version)
    .parse(c.req.query("through") ?? story.version);
  return c.json(await publicArchive(c.env, story.id, version));
});
app.post("/api/stories", async (c) => {
  const user = requireUser(c, true);
  await rateLimit(c.env, `new-story:${user.id}`, 3, 3600000);
  const input = storyInputSchema.parse(await c.req.json()),
    settings = await getSettings(c.env);
  const count = await c.env.DB.prepare(
    "SELECT count(*) AS n FROM stories WHERE owner_id=?",
  )
    .bind(user.id)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= settings.maxStoriesPerUser)
    throw new AppError(
      "story_limit",
      "You have reached your current world limit.",
      409,
    );
  const id = crypto.randomUUID(),
    now = Date.now();
  const slugBase =
    input.title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "story";
  const slug = `${slugBase}-${id.slice(0, 6)}`;
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO stories(id,slug,owner_id,title,logline,genre,world_rules,visual_style,status,fixture,created_at,updated_at,cover_url) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'/art/new-world.svg')",
    ).bind(
      id,
      slug,
      user.id,
      input.title,
      input.logline,
      input.genre,
      input.worldRules,
      input.visualStyle,
      "draft",
      isDevelopment(c.env) ? 1 : 0,
      now,
      now,
    ),
    ...input.characters.map((ch, i) =>
      c.env.DB.prepare(
        "INSERT INTO characters(id,story_id,name,description,state) VALUES(?,?,?,?,?)",
      ).bind(`${id}:character:${i + 1}`, id, ch.name, ch.description, ch.state),
    ),
  ]);
  await audit(c.env, user.id, "story.created", id);
  return c.json({ story: await getStory(c.env, id) }, 201);
});
app.patch("/api/stories/:id", async (c) => {
  const user = requireUser(c, true),
    story = await getStory(c.env, c.req.param("id"));
  if (user.id !== story.ownerId && user.role !== "admin")
    throw new AppError(
      "forbidden",
      "Only this story’s owner can change its state.",
      403,
    );
  const { status } = z
    .object({ status: z.enum(["open", "paused"]) })
    .parse(await c.req.json());
  await c.env.DB.prepare("UPDATE stories SET status=?,updated_at=? WHERE id=?")
    .bind(status, Date.now(), story.id)
    .run();
  await audit(c.env, user.id, `story.${status}`, story.id);
  if (status === "open")
    await c.env.STORY_ROOMS.getByName(story.id).kick(story.id);
  return c.json({ ok: true });
});
app.post("/api/stories/:id/favorite", async (c) => {
  const user = requireUser(c),
    story = await getStory(c.env, c.req.param("id"));
  const { favorite } = z
    .object({ favorite: z.boolean() })
    .parse(await c.req.json());
  await c.env.DB.prepare(
    favorite
      ? "INSERT OR IGNORE INTO favorites VALUES(?,?)"
      : "DELETE FROM favorites WHERE user_id=? AND story_id=?",
  )
    .bind(user.id, story.id)
    .run();
  return c.json({ ok: true });
});
app.put("/api/stories/:id/progress", async (c) => {
  const user = requireUser(c),
    story = await getStory(c.env, c.req.param("id"));
  const body = z
    .object({ episodeId: z.string(), timeMs: z.number().int().nonnegative() })
    .parse(await c.req.json());
  const episode = await c.env.DB.prepare(
    "SELECT duration_ms FROM episodes WHERE id=? AND story_id=?",
  )
    .bind(body.episodeId, story.id)
    .first<{ duration_ms: number }>();
  if (!episode || body.timeMs > episode.duration_ms)
    throw new AppError(
      "invalid_progress",
      "That position does not belong to this story.",
      400,
    );
  await c.env.DB.prepare(
    "INSERT INTO watch_progress VALUES(?,?,?,?,?) ON CONFLICT(user_id,story_id) DO UPDATE SET episode_id=excluded.episode_id,time_ms=excluded.time_ms,updated_at=excluded.updated_at",
  )
    .bind(user.id, story.id, body.episodeId, body.timeMs, Date.now())
    .run();
  return c.json({ ok: true });
});
app.get("/api/stories/:id/events", async (c) => {
  const story = await getStory(c.env, c.req.param("id"));
  if (
    story.status === "draft" &&
    story.ownerId !== c.get("user")?.id &&
    c.get("user")?.role !== "admin"
  )
    throw new AppError("not_found", "Story not found.", 404);
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket")
    return c.json(
      { error: { message: "A WebSocket connection is required." } },
      400,
    );
  if (c.req.header("Origin") !== c.env.PUBLIC_ORIGIN)
    throw new AppError(
      "origin_rejected",
      "The connection origin was not accepted.",
      403,
    );
  const target = new URL(c.req.url);
  target.searchParams.set("storyId", story.id);
  return c.env.STORY_ROOMS.getByName(story.id).fetch(
    new Request(target, c.req.raw),
  );
});
app.post("/api/stories/:id/tasks", async (c) => {
  const user = requireUser(c, true),
    story = await getStory(c.env, c.req.param("id"));
  if (
    story.status === "draft" &&
    story.ownerId !== user.id &&
    user.role !== "admin"
  )
    throw new AppError("not_found", "This story is not open yet.", 404);
  await rateLimit(c.env, `draft:${user.id}`, 10);
  const input = promptInputSchema.parse(await c.req.json());
  const requestedCast = JSON.stringify([...input.characterIds].sort());
  const prior = await c.env.DB.prepare(
    "SELECT id,story_id,prompt_original,requested_character_ids_json,generation_mode FROM tasks WHERE user_id=? AND idempotency_key=?",
  )
    .bind(user.id, input.idempotencyKey)
    .first<{
      id: string;
      story_id: string;
      prompt_original: string;
      requested_character_ids_json: string;
      generation_mode: string;
    }>();
  if (prior) {
    if (
      prior.story_id !== story.id ||
      prior.prompt_original !== input.prompt ||
      prior.requested_character_ids_json !== requestedCast ||
      prior.generation_mode !== input.generationMode
    )
      throw new AppError(
        "idempotency_conflict",
        "This submission key has already been used for another idea.",
        409,
      );
    return c.json({ task: taskDto(await getTask(c.env, prior.id)) });
  }
  const offer = await generationOffer(c.env);
  if (input.generationMode === "reference" && !offer.referenceEnabled)
    throw new AppError(
      "reference_unavailable",
      "Reference-guided creation is being prepared. You can use free text-to-video today.",
      409,
    );
  const availableCharacters = await getCharacters(
    c.env,
    story.id,
    story.version,
  );
  if (
    input.characterIds.some(
      (id) => !availableCharacters.some((ch) => ch.id === id),
    )
  )
    throw new AppError(
      "invalid_requested_cast",
      "Choose characters already introduced in this story.",
      400,
    );
  const id = crypto.randomUUID(),
    now = Date.now();
  await c.env.DB.prepare(
    "INSERT INTO tasks(id,story_id,user_id,prompt_original,base_version,idempotency_key,created_at,updated_at,requested_character_ids_json,generation_mode,provider_model,quoted_points,quoted_reserve_cents) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,idempotency_key) DO NOTHING",
  )
    .bind(
      id,
      story.id,
      user.id,
      input.prompt,
      story.version,
      input.idempotencyKey,
      now,
      now,
      requestedCast,
      input.generationMode,
      generationModels[input.generationMode],
      input.generationMode === "reference" ? offer.referencePoints : 0,
      input.generationMode === "reference" ? offer.referenceReserveCents : 0,
    )
    .run();
  const saved = await c.env.DB.prepare(
    "SELECT id,story_id,prompt_original,requested_character_ids_json,generation_mode FROM tasks WHERE user_id=? AND idempotency_key=?",
  )
    .bind(user.id, input.idempotencyKey)
    .first<{
      id: string;
      story_id: string;
      prompt_original: string;
      requested_character_ids_json: string;
      generation_mode: string;
    }>();
  if (
    !saved ||
    saved.story_id !== story.id ||
    saved.prompt_original !== input.prompt ||
    saved.requested_character_ids_json !== requestedCast ||
    saved.generation_mode !== input.generationMode
  )
    throw new AppError(
      "idempotency_conflict",
      "This submission key has already been used for another idea.",
      409,
    );
  return c.json(
    { task: taskDto(await getTask(c.env, saved.id)) },
    saved.id === id ? 201 : 200,
  );
});
async function ownTask(c: Parameters<typeof requireUser>[0], creating = true) {
  const user = requireUser(c, creating),
    t = await getTask(c.env, c.req.param("id")!);
  if (t.user_id !== user.id)
    throw new AppError(
      "forbidden",
      "This contribution belongs to another storyteller.",
      403,
    );
  return t;
}
app.post("/api/tasks/:id/preview", async (c) => {
  const t = await ownTask(c);
  if (!["Draft", "NeedsReview"].includes(t.status))
    throw new AppError(
      "task_changed",
      "This contribution is already being processed.",
      409,
    );
  await rateLimit(c.env, `preview:${t.user_id}`, 3);
  await rateLimit(c.env, `preview-day:${t.user_id}`, 15, 86400000);
  const lock = crypto.randomUUID();
  const claimed = await c.env.DB.prepare(
    "UPDATE tasks SET preview_lock=?,preview_locked_at=? WHERE id=? AND status IN ('Draft','NeedsReview') AND (preview_lock IS NULL OR preview_locked_at<?) RETURNING id",
  )
    .bind(lock, Date.now(), t.id, Date.now() - 120000)
    .first();
  if (!claimed)
    throw new AppError(
      "preview_in_progress",
      "A preview is already being prepared. Please wait for it to finish.",
      409,
    );
  try {
    const { plan, baseVersion } = await preparePlan(c.env, t);
    const saved = await c.env.DB.prepare(
      "UPDATE tasks SET plan_json=?,base_version=?,updated_at=?,preview_lock=NULL WHERE id=? AND preview_lock=? AND status IN ('Draft','NeedsReview') AND (SELECT version FROM stories WHERE id=tasks.story_id)=? RETURNING id",
    )
      .bind(
        JSON.stringify(plan),
        baseVersion,
        Date.now(),
        t.id,
        lock,
        baseVersion,
      )
      .first();
    if (!saved)
      throw new AppError(
        "story_changed",
        "The story advanced while this preview was being prepared. Preview the idea again against the new scene.",
        409,
      );
  } finally {
    await c.env.DB.prepare(
      "UPDATE tasks SET preview_lock=NULL WHERE id=? AND preview_lock=?",
    )
      .bind(t.id, lock)
      .run();
  }
  return c.json({ task: taskDto(await getTask(c.env, t.id)) });
});
app.post("/api/tasks/:id/accept", async (c) => {
  const t = await ownTask(c);
  const input = z
    .object({
      planUpdatedAt: z.number(),
      publicAttributionAccepted: z.literal(true),
    })
    .parse(await c.req.json());
  if (t.status === "Queued" || t.reservation_active)
    return c.json({ task: taskDto(t) });
  if (t.updated_at !== input.planUpdatedAt)
    throw new AppError(
      "plan_changed",
      "The scene plan has changed. Review it before continuing.",
      409,
    );
  await assertOwnerApproval(c.env, t);
  if (String(c.env.PROVIDER_MODE) === "disabled")
    throw new AppError(
      "generation_unavailable",
      "Creation is not available yet. Your idea is saved.",
      503,
    );
  if (
    String(c.env.PROVIDER_MODE) === "live" &&
    videoMode(t.provider_model) === "reference" &&
    t.plan_json
  )
    await selectedMaterials(c.env, t.id, t.story_id, JSON.parse(t.plan_json));
  if (
    t.generation_mode === "reference" &&
    !(await generationOffer(c.env)).referenceEnabled
  )
    throw new AppError(
      "reference_unavailable",
      "Reference-guided creation is paused. Your points have not been reserved.",
      409,
    );
  await acceptTask(c.env, t);
  // Queued work is durable before scheduling; a transient wake-up failure is recoverable by cron.
  try {
    await c.env.STORY_ROOMS.getByName(t.story_id).kick(t.story_id);
  } catch {
    await audit(c.env, null, "queue.wakeup-deferred", t.id);
  }
  return c.json({ task: taskDto(await getTask(c.env, t.id)) });
});
app.post("/api/tasks/:id/cancel", async (c) => {
  const t = await ownTask(c, false);
  if (
    !(await transition(
      c.env,
      t.id,
      ["Draft", "NeedsReview", "Queued"],
      "Cancelled",
      "Withdrawn by the author.",
    ))
  )
    throw new AppError(
      "already_started",
      "This scene has already started. Contact the studio if it needs attention.",
      409,
    );
  await c.env.STORY_ROOMS.getByName(t.story_id).broadcast({
    type: "queue.updated",
    storyId: t.story_id,
  });
  return c.json({ ok: true });
});
app.get("/api/tasks", async (c) => {
  const user = requireUser(c);
  const rows = (
    await c.env.DB.prepare(
      "SELECT t.*,u.display_name AS author FROM tasks t JOIN users u ON u.id=t.user_id WHERE t.user_id=? ORDER BY t.created_at DESC LIMIT 100",
    )
      .bind(user.id)
      .all<TaskRow>()
  ).results;
  return c.json({ tasks: rows.map((t) => taskDto(t)) });
});
app.get("/api/tasks/:id", async (c) => {
  const t = await ownTask(c, false);
  return c.json({ task: taskDto(t) });
});
app.on(["GET", "HEAD"], "/api/scenes/:id/video", async (c) => {
  if (c.req.header("Sec-Fetch-Site") === "cross-site")
    throw new AppError(
      "embed_unavailable",
      `Open this story on ${brand.name} to watch it.`,
      403,
    );
  const row = await c.env.DB.prepare(
    "SELECT s.media_key,s.hidden,s.story_id,st.fixture FROM scenes s JOIN stories st ON s.story_id=st.id WHERE s.id=?",
  )
    .bind(c.req.param("id"))
    .first<{
      media_key: string;
      hidden: number;
      fixture: number;
      story_id: string;
    }>();
  if (!row || row.hidden)
    throw new AppError("not_found", "This scene is not available.", 404);
  if (row.media_key.startsWith("fixture:")) {
    if (!isDevelopment(c.env) || !row.fixture)
      throw new AppError("not_found", "Not found.", 404);
    return c.env.ASSETS.fetch(
      new Request(
        new URL(
          row.story_id === "quiet-orbit"
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
  }
  return serveR2(c.env, row.media_key, c.req.raw, "video/mp4", true);
});
app.get("/api/scenes/:id/captions", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT captions_key,hidden,fixture FROM scenes WHERE id=?",
  )
    .bind(c.req.param("id"))
    .first<{ captions_key: string; hidden: number; fixture: number }>();
  if (!row || row.hidden)
    throw new AppError("not_found", "This scene is not available.", 404);
  if (
    row.captions_key.startsWith("fixture:") &&
    isDevelopment(c.env) &&
    row.fixture
  )
    return c.body(
      "WEBVTT\n\n00:00.000 --> 00:10.000\nDevelopment playback sample.\n",
      200,
      { "Content-Type": "text/vtt; charset=utf-8" },
    );
  if (!row.captions_key)
    return c.body("WEBVTT\n", 200, {
      "Content-Type": "text/vtt; charset=utf-8",
    });
  return serveR2(c.env, row.captions_key, c.req.raw, "text/vtt; charset=utf-8");
});
app.post("/api/reports", async (c) => {
  const user = requireUser(c),
    input = z
      .object({
        storyId: z.string(),
        sceneId: z.string().optional(),
        reason: z.string().trim().min(10).max(2000),
      })
      .parse(await c.req.json());
  await getStory(c.env, input.storyId);
  await rateLimit(c.env, `report:${user.id}`, 3, 3600000);
  if (
    input.sceneId &&
    !(await c.env.DB.prepare("SELECT id FROM scenes WHERE id=? AND story_id=?")
      .bind(input.sceneId, input.storyId)
      .first())
  )
    throw new AppError(
      "invalid_scene",
      "The scene does not belong to this story.",
      400,
    );
  await c.env.DB.prepare(
    "INSERT INTO reports(id,user_id,story_id,scene_id,reason,created_at) VALUES(?,?,?,?,?,?)",
  )
    .bind(
      crypto.randomUUID(),
      user.id,
      input.storyId,
      input.sceneId ?? null,
      input.reason,
      Date.now(),
    )
    .run();
  return c.json({ ok: true }, 201);
});
app.post("/api/notifications/read", async (c) => {
  const user = requireUser(c);
  await c.env.DB.prepare(
    "UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL",
  )
    .bind(Date.now(), user.id)
    .run();
  return c.json({ ok: true });
});
app.route("/api/billing", billing);
app.route("/api", governance);
app.route("/api/admin", admin);
app.notFound((c) =>
  c.json(
    { error: { code: "not_found", message: "This API route does not exist." } },
    404,
  ),
);

async function reconcile(env: Cloudflare.Env) {
  await reconcilePayments(env);
  if (String(env.PROVIDER_MODE) === "live") {
    try {
      await refreshBalance(env);
    } catch {
      console.error(JSON.stringify({ event: "provider.balance-check-failed" }));
    }
  }
  const stories = (
    await env.DB.prepare(
      "SELECT id FROM stories WHERE active_task_id IS NOT NULL OR (status='open' AND EXISTS(SELECT 1 FROM tasks WHERE story_id=stories.id AND status='Queued')) LIMIT 100",
    ).all<{ id: string }>()
  ).results;
  for (const s of stories) {
    try {
      await env.STORY_ROOMS.getByName(s.id).kick(s.id);
    } catch {
      console.error(
        JSON.stringify({ event: "queue.recovery-failed", storyId: s.id }),
      );
    }
  }
  await dispatchArchives(env);
  const outbox = (
    await env.DB.prepare(
      "SELECT id,story_id FROM outbox WHERE sent_at IS NULL ORDER BY created_at LIMIT 100",
    ).all<{ id: string; story_id: string }>()
  ).results;
  for (const event of outbox) {
    await env.STORY_ROOMS.getByName(event.story_id).broadcast({
      type: "story.updated",
      storyId: event.story_id,
    });
    await env.DB.prepare(
      "UPDATE outbox SET sent_at=? WHERE id=? AND sent_at IS NULL",
    )
      .bind(Date.now(), event.id)
      .run();
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM rate_limits WHERE expires_at<?").bind(
      Date.now(),
    ),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at<?").bind(Date.now()),
  ]);
}
export default {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    if (new URL(request.url).pathname.startsWith("/api/"))
      return app.fetch(request, env, ctx);
    if (new URL(request.url).pathname.startsWith("/story/"))
      return sharePage(request, env);
    return env.ASSETS.fetch(request);
  },
  async scheduled(_controller: ScheduledController, env: Cloudflare.Env) {
    await recordedReconciliation(env, () => reconcile(env));
  },
} satisfies ExportedHandler<Cloudflare.Env>;

export { app };
