declare namespace Cloudflare {
  interface Env {
    PADDLE_API_KEY?: string;
    PADDLE_WEBHOOK_SECRET?: string;
    PADDLE_CLIENT_TOKEN?: string;
    PADDLE_ENVIRONMENT?: string;
    PADDLE_LIVE_APPROVED?: string;
    REFERENCE_GENERATION_ENABLED?: string;
    BETTER_AUTH_SECRET?: string;
    FAL_KEY?: string;
    FAL_ADMIN_KEY?: string;
    DIRECTOR_API_KEY?: string;
    STREAM_API_TOKEN?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    TURNSTILE_SECRET_KEY?: string;
    TURNSTILE_SITE_KEY?: string;
  }
}
