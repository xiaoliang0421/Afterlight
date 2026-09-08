import type { Context } from "hono";
import { requireUser, type AppEnv } from "./auth";
import { AppError } from "./errors";
import type { Story, User } from "../shared/domain";

export async function communityAccess(env: Cloudflare.Env, user: User | null) {
  if (!user) return { canContribute: false, canHost: false };
  const row = await env.DB.prepare(
    "SELECT u.contribution_access AS access,s.invitation_only FROM users u CROSS JOIN settings s WHERE u.id=? AND u.deleted_at IS NULL AND s.id=1",
  )
    .bind(user.id)
    .first<{ access: string; invitation_only: number }>();
  const active = !!row && row.access !== "suspended";
  return {
    canContribute:
      active &&
      (!row.invitation_only || ["member", "host"].includes(row.access)),
    canHost: active && (!row.invitation_only || row.access === "host"),
  };
}
export async function requireContributor(c: Context<AppEnv>, host = false) {
  const user = requireUser(c, true);
  const access = await communityAccess(c.env, user);
  if (!(host ? access.canHost : access.canContribute))
    throw new AppError(
      host ? "host_invitation_required" : "invitation_required",
      host
        ? "Story hosting is by invitation. Contact the studio to join."
        : "Creating is by invitation during early access. You can still watch and manage your account.",
      403,
    );
  return user;
}
export function visibleStory(story: Story, user: User | null) {
  if (
    (story.status === "draft" || story.reviewStatus !== "approved") &&
    story.ownerId !== user?.id &&
    user?.role !== "admin"
  )
    throw new AppError("not_found", "This story is not available.", 404);
}
