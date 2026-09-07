import { z } from "zod";
import { AppError } from "./errors";
import { isDevelopment } from "./auth";

export async function verifyHuman(
  env: Cloudflare.Env,
  request: Request,
  action: string,
) {
  const hostname = new URL(env.PUBLIC_ORIGIN).hostname;
  // Local fixtures can run offline. Neither staging nor production can use this bypass.
  if (
    isDevelopment(env) &&
    String(env.PROVIDER_MODE) === "fixture" &&
    ["localhost", "127.0.0.1"].includes(hostname) &&
    !env.TURNSTILE_SITE_KEY &&
    !env.TURNSTILE_SECRET_KEY
  )
    return;
  if (!env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET_KEY)
    throw new AppError(
      "verification_unavailable",
      "Creation verification is not configured yet. Please try again later.",
      503,
    );
  const token = request.headers.get("X-Turnstile-Token");
  if (!token || token.length > 2048)
    throw new AppError(
      "verification_required",
      "Complete the security check before continuing.",
      403,
    );
  let data: unknown;
  try {
    const body = new URLSearchParams({
      secret: env.TURNSTILE_SECRET_KEY,
      response: token,
    });
    const ip = request.headers.get("CF-Connecting-IP");
    if (ip) body.set("remoteip", ip);
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body,
        // workerd rejects redirect:"error". Manual mode returns redirects to
        // the non-2xx check below without forwarding the secret or token.
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) throw new Error("siteverify unavailable");
    data = await response.json();
  } catch {
    throw new AppError(
      "verification_unavailable",
      "The security check is temporarily unavailable. Please try again.",
      503,
    );
  }
  const result = z
    .object({
      success: z.literal(true),
      hostname: z.literal(hostname),
      action: z.literal(action),
    })
    .safeParse(data);
  if (!result.success)
    throw new AppError(
      "verification_failed",
      "The security check expired or failed. Please complete a fresh check and try again.",
      403,
    );
}
