import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin, sha256, type AppEnv } from "./auth";
import { getStory, getCharacters, audit } from "./store";
import { AppError } from "./errors";

export const moderation = new Hono<AppEnv>();
moderation.use("*", async (c, next) => {
  requireAdmin(c);
  await next();
});
moderation.get("/community", async (c) =>
  c.json({
    users: (
      await c.env.DB.prepare(
        "SELECT id,email,display_name AS nickname,public_name AS publicName,name_review_note AS reviewNote,contribution_access AS access,role FROM users WHERE deleted_at IS NULL ORDER BY (display_name!=public_name) DESC,created_at DESC LIMIT 100",
      ).all()
    ).results,
    stories: (
      await c.env.DB.prepare(
        "SELECT s.id,s.title,s.logline,s.status,s.review_status AS reviewStatus,s.review_note AS reviewNote,s.publication_hold AS publicationHold,u.public_name AS host FROM stories s JOIN users u ON u.id=s.owner_id ORDER BY (s.review_status='pending' OR s.publication_hold=1) DESC,s.updated_at DESC LIMIT 100",
      ).all()
    ).results,
  }),
);
moderation.post("/community/users/:id", async (c) => {
  const input = z
    .object({
      access: z.enum(["none", "member", "host", "suspended"]),
      reason: z.string().trim().min(10).max(600),
    })
    .parse(await c.req.json());
  const target = await c.env.DB.prepare(
    "SELECT id,role FROM users WHERE id=? AND deleted_at IS NULL",
  )
    .bind(c.req.param("id"))
    .first<{ id: string; role: string }>();
  if (!target) throw new AppError("not_found", "Account not found.", 404);
  if (target.role === "admin")
    throw new AppError(
      "admin_access",
      "Studio accounts are managed separately from community invitations.",
      409,
    );
  await c.env.DB.prepare(
    "UPDATE users SET contribution_access=? WHERE id=? AND deleted_at IS NULL",
  )
    .bind(input.access, target.id)
    .run();
  await audit(c.env, requireAdmin(c).id, "community.access", target.id, input);
  return c.json({ ok: true });
});
moderation.post("/community/users/:id/name", async (c) => {
  const input = z
    .object({
      nickname: z.string().min(2).max(30),
      approved: z.boolean(),
      reason: z.string().trim().min(10).max(600),
    })
    .parse(await c.req.json());
  const row = await c.env.DB.prepare(
    "UPDATE users SET public_name=CASE WHEN ?=1 THEN display_name ELSE '' END,name_review_note=? WHERE id=? AND display_name=? AND deleted_at IS NULL RETURNING id",
  )
    .bind(
      Number(input.approved),
      input.reason,
      c.req.param("id"),
      input.nickname,
    )
    .first();
  if (!row)
    throw new AppError(
      "review_changed",
      "The nickname changed. Refresh before reviewing it.",
      409,
    );
  await audit(
    c.env,
    requireAdmin(c).id,
    "community.name-reviewed",
    c.req.param("id"),
    input,
  );
  return c.json({ ok: true });
});
async function storyReview(env: Cloudflare.Env, id: string) {
  const story = await getStory(env, id),
    characters = await getCharacters(env, story.id);
  const snapshot = { story, characters };
  return { ...snapshot, token: await sha256(JSON.stringify(snapshot)) };
}
moderation.get("/community/stories/:id", async (c) =>
  c.json(await storyReview(c.env, c.req.param("id"))),
);
moderation.post("/community/stories/:id", async (c) => {
  const input = z
    .object({
      action: z.enum(["approve", "reject", "block"]),
      token: z.string().length(64),
      reviewed: z.literal(true),
      reason: z.string().trim().min(10).max(600),
    })
    .parse(await c.req.json());
  const review = await storyReview(c.env, c.req.param("id"));
  if (review.token !== input.token)
    throw new AppError(
      "review_changed",
      "The story changed. Read the current version before reviewing it.",
      409,
    );
  const st = review.story;
  const changed = await c.env.DB.prepare(
    "UPDATE stories SET review_status=?,review_note=?,publication_hold=?,status=?,updated_at=? WHERE id=? AND updated_at=? AND title=? AND logline=? AND world_rules=? AND visual_style=? RETURNING id",
  )
    .bind(
      input.action === "approve"
        ? "approved"
        : input.action === "reject"
          ? "rejected"
          : "blocked",
      input.reason,
      Number(input.action !== "approve"),
      input.action === "approve" ? "open" : "paused",
      Date.now(),
      st.id,
      st.updatedAt,
      st.title,
      st.logline,
      st.worldRules,
      st.visualStyle,
    )
    .first();
  if (!changed)
    throw new AppError(
      "review_changed",
      "The story changed. Refresh before reviewing it.",
      409,
    );
  await audit(
    c.env,
    requireAdmin(c).id,
    "community.story-reviewed",
    st.id,
    input,
  );
  await c.env.STORY_ROOMS.getByName(st.id).broadcast({
    type: "story.updated",
    storyId: st.id,
  });
  if (input.action === "approve")
    await c.env.STORY_ROOMS.getByName(st.id).kick(st.id);
  return c.json({ ok: true });
});
moderation.get("/community/tasks/:id/ideas", async (c) =>
  c.json({
    ideas: (
      await c.env.DB.prepare(
        "SELECT p.id,p.prompt,u.display_name AS nickname,u.public_name AS publicName FROM story_proposals p JOIN users u ON u.id=p.author_id WHERE p.selected_task_id=? ORDER BY p.id",
      )
        .bind(c.req.param("id"))
        .all()
    ).results,
  }),
);
