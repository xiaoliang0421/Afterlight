# Cloudflare deployment

The owner has supplied a dedicated GitHub repository for this product. On 2026-09-06, the owner activated R2 and the implementation created `afterlight-staging-media` and `afterlight-production-media`. Both have r2.dev access disabled and no public custom domains; their names match the existing MEDIA bindings. Separate D1 databases `afterlight-staging` and `afterlight-production` were also created and their IDs saved in `wrangler.jsonc`. The staging origin is `https://afterlight-staging.liushenliang1994.workers.dev`; this URL is configured but not deployed. All 17 schema migrations were applied to both databases through the authenticated Cloudflare API, with standard Wrangler migration tracking. Read-back confirmed zero users/stories/scenes, generation disabled and an authorized model-spend ceiling of zero. Worker deployment and secrets remain pending. The production origin remains a placeholder and production preflight still blocks release.

## GitHub

Use a dedicated private repository containing this product directory only. Do not publish the surrounding personal context repository. Push the `codex/initial-product` branch for review. `.github/workflows/check.yml` runs type checks, application tests, build and isolated Cloudflare integration tests without cloud secrets or paid model calls.

Connect the repository to Cloudflare Workers Builds after selecting the actual account and worker. Keep staging and production as distinct workers and bindings. Preview builds must use staging resources. Production publication remains an explicit reviewed release, not an automatic consequence of opening a pull request.

## Provisioning order

1. Select the account, production domain, staging domain and a support contact. Review current Cloudflare charges and authorize infrastructure spending before provisioning paid resources.
2. Create separate D1 databases and R2 buckets for staging and production. Put their returned IDs/names into the matching `wrangler.jsonc` environment. Never use a local database ID remotely.
3. Leave `PROVIDER_MODE=disabled`, `ALLOW_DEV_LOGIN=false`, `PAYMENTS_ENABLED=false`. Deploy the web/auth shell only after static preflight passes.
4. Apply migrations to the explicit target environment. Never seed a remote database with development fixtures.
5. Configure Google OAuth for each exact callback URL: `https://<origin>/api/auth/callback/google`. Reusing the Better Auth implementation does not share ToolMoss cookies, users or OAuth credentials automatically.
6. Supply environment-specific secrets with Wrangler Secrets or the Cloudflare dashboard. Required for login: `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Generation requires `FAL_KEY`, `FAL_ADMIN_KEY`, `DIRECTOR_API_KEY`; use the provider's documented scope for balance access. Do not commit secrets or put them into `VITE_*` variables.
7. Grant the first verified owner a studio role through a reviewed D1 operation using that account’s actual immutable user ID. The public website has no role-grant endpoint.
8. Record an explicit test ceiling and set D1 `settings.authorized_spend_cents` to that amount. Verify the current provider price and conservative per-scene reserve, then configure day/month limits within the ceiling. Confirm real provider balance access before accepting tasks.
9. In staging, record `testApprovedAt` and `approvedBudgetCents` in a release acceptance record before changing to `PROVIDER_MODE=live`. That authorization permits controlled testing, not public launch.
10. Complete real media, continuity, recovery, abuse protection, privacy operations and Cloudflare resource acceptance. Record evidence and copy the acceptance template to `release.acceptance.json` with verified results. Only then run production preflight and publish.

Start with the [service setup guide](API-SETUP.md). A deposited provider balance does not authorize spending the entire balance. The local fixture reserve of 150 cents is deliberately test data and must not be used as a real continuation quote: reference-video input alone can make a ten-second scene cost more than that. The runtime rejects a reserve below the known output/video/voice cost floor, but image-input costs, changing rates and the final conservative ceiling still require explicit validation before live use.

## Commands

```sh
npm run deploy:check -- staging
npx wrangler d1 migrations apply DB --env staging --remote
npm run deploy:staging
```

Use `production` explicitly for the corresponding production operations. `npm run deploy:check` performs static configuration and evidence checks; it does not prove remote secrets, quota, invoices or OAuth settings exist. Inspect those through their service APIs and actual smoke tests.

```sh
npm run build
npx wrangler deploy --dry-run --env staging
```

Dry run bundles the Worker without publishing. Do not deploy the root development configuration, even if Wrangler allows it directly.

## Media launch work

Archived MP4 range delivery currently works. The broader design calls for evaluating Stream transcoding and a container/FFmpeg path for whole-episode packaging. Neither is currently implemented. Confirm storage ownership, Stream readiness/error recovery, adaptive playback, captions, seek mapping and at least ten real consecutive clips on mobile before selecting and releasing that media pipeline. Normal Workers must not run full FFmpeg processing in memory.

## References

- [Workers static assets](https://developers.cloudflare.com/workers/static-assets/)
- [Workers Builds Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/)
- [Workflows local development](https://developers.cloudflare.com/workflows/build/local-development/)
- [Stream readiness webhooks](https://developers.cloudflare.com/stream/manage-video-library/using-webhooks/)
- [Cloudflare Containers](https://developers.cloudflare.com/containers/)

## Creation verification and private media

Configure a separate managed Turnstile widget for each deployment hostname. Set its public site key in `TURNSTILE_SITE_KEY` and the matching secret through Cloudflare Secrets as `TURNSTILE_SECRET_KEY`. Only local fixture mode with a loopback PUBLIC_ORIGIN can bypass missing keys. Staging/production creation fails closed if either key is missing. Never allow localhost on a production widget or use Cloudflare dummy test keys in a remote environment. The server validates the exact action and PUBLIC_ORIGIN hostname; each browser action renders a fresh single-use widget. Run a real challenge/expiration/reuse test after deployment.

Keep R2 public domains off. Published MP4s are delivered by the Worker after checking scene visibility; unpublished originals require studio authentication. Cross-site browser video requests are rejected and R2 responses use `Cross-Origin-Resource-Policy: same-origin`. These are basic embedding/access controls, not DRM: someone allowed to watch a public clip can still copy or record it.

The existing Cloudflare MCP connection can provision resources. Local Wrangler is not yet authenticated; the attempted browser OAuth flow was interrupted before completion. Continue the official Wrangler login with OS keychain storage, confirm the migration journal, then deploy the disabled-generation shell. Never copy OAuth tokens into the repository.
