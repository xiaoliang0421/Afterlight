import { betterAuth } from "better-auth";
import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import type { User } from "../shared/domain";
import { AppError } from "./errors";
import policies from "../shared/policies.json";
import { brand } from "../shared/brand";

export type AppEnv = {
  Bindings: Cloudflare.Env;
  Variables: { user: User | null; requestId: string };
};
export function isDevelopment(env: Cloudflare.Env) {
  return (
    String(env.ENVIRONMENT) === "development" &&
    String(env.ALLOW_DEV_LOGIN) === "true"
  );
}
export function authConfigured(env: Cloudflare.Env) {
  return !!(
    env.BETTER_AUTH_SECRET &&
    env.GOOGLE_CLIENT_ID &&
    env.GOOGLE_CLIENT_SECRET
  );
}
export function createAuth(env: Cloudflare.Env) {
  if (!env.BETTER_AUTH_SECRET)
    throw new AppError(
      "auth_unavailable",
      "Sign-in is not configured yet.",
      503,
    );
  return betterAuth({
    appName: brand.name,
    baseURL: env.PUBLIC_ORIGIN,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    trustedOrigins: [env.PUBLIC_ORIGIN],
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {},
    emailAndPassword: { enabled: false },
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
    advanced: {
      useSecureCookies: new URL(env.PUBLIC_ORIGIN).protocol === "https:",
      cookiePrefix: "afterlight",
    },
  });
}
export async function sha256(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export async function currentUser(c: Context<AppEnv>): Promise<User | null> {
  let id: string | undefined;
  if (isDevelopment(c.env)) {
    const token = getCookie(c, "afterlight-dev");
    if (token)
      id = (
        await c.env.DB.prepare(
          "SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?",
        )
          .bind(await sha256(token), Date.now())
          .first<{ user_id: string }>()
      )?.user_id;
  }
  if (!id && authConfigured(c.env)) {
    const result = await createAuth(c.env).api.getSession({
      headers: c.req.raw.headers,
    });
    if (result?.user) {
      id = result.user.id;
      // Provider names are not automatically made public. The user chooses a nickname.
      await c.env.DB.prepare(
        "INSERT OR IGNORE INTO users(id,email,display_name,created_at) VALUES(?,?,'',?)",
      )
        .bind(id, result.user.email, Date.now())
        .run();
    }
  }
  if (!id) return null;
  const row = await c.env.DB.prepare(
    "SELECT id,email,display_name,role,EXISTS(SELECT 1 FROM policy_acceptances p JOIN policy_documents d ON d.version=p.version WHERE p.user_id=users.id AND p.version=? AND d.document_json=?) AS policy_accepted FROM users WHERE id=? AND deleted_at IS NULL",
  )
    .bind(policies.version, JSON.stringify(policies), id)
    .first<{
      id: string;
      email: string;
      display_name: string;
      role: User["role"];
      policy_accepted: number;
    }>();
  return row
    ? {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        role: row.role,
        policyAccepted: !!row.policy_accepted,
      }
    : null;
}
export function requireUser(c: Context<AppEnv>, nickname = false): User {
  const user = c.get("user");
  if (!user)
    throw new AppError("sign_in_required", "Sign in to continue.", 401);
  if (nickname && !user.displayName)
    throw new AppError(
      "nickname_required",
      "Choose your public storyteller name first.",
      409,
    );
  if (nickname && !user.policyAccepted)
    throw new AppError(
      "policy_acceptance_required",
      "Review the current terms and privacy notice before creating.",
      409,
    );
  return user;
}
export function requireAdmin(c: Context<AppEnv>) {
  const user = requireUser(c);
  if (user.role !== "admin")
    throw new AppError(
      "forbidden",
      "This action is only available to the studio team.",
      403,
    );
  return user;
}
export async function rateLimit(
  env: Cloudflare.Env,
  key: string,
  max: number,
  windowMs = 60000,
) {
  const now = Date.now();
  const row = await env.DB.prepare(
    "INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count",
  )
    .bind(key, now + windowMs, now, now)
    .first<{ count: number }>();
  if (!row || row.count > max)
    throw new AppError(
      "rate_limited",
      "Please wait a moment before trying again.",
      429,
    );
}
