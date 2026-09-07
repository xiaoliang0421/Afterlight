# Cloudflare deployment

TaleRelay is reachable at **https://app.tailrelay.com**, bound to the isolated `afterlight-staging` Worker. The owner confirmed `tailrelay.com` is the purchased domain; it is separate from the TaleRelay brand spelling and Proton mailbox. HTTPS and public health/bootstrap requests pass. Turnstile permits this exact hostname. The old workers.dev and preview endpoints are disabled. Generation, checkout and development login remain disabled pending account/configuration acceptance.

Separate private R2 buckets (`afterlight-staging-media`, `afterlight-production-media`) and D1 databases exist. `StoryRoom`, both staging Workflows and the five-minute cron are deployed. No local footage, fixture records, source maps, provider keys or personal context are published. Session, Turnstile, fal generation and DeepSeek director secrets are provisioned; Google OAuth credentials and a balance-capable fal credential are still needed. Production preflight still blocks a public service launch until policies and real acceptance are complete.

A separate Google Cloud project `talerelay` was created without changing ToolMoss. The branding form has the application name, existing Gmail support address, external testing audience and Proton notification address filled in; it is waiting at the Google API user-data-policy acceptance step. The site support email remains `talerelay@proton.me`. No Google OAuth client has been created yet. Resume using the [engineering plan](ENGINEERING-PLAN.md), after rechecking the form and pending confirmation.

On 2026-09-07 the remote staging D1 export (18 applied migrations) restored successfully into an isolated in-memory SQLite database: integrity check `ok`, zero foreign-key violations, 108 non-internal schema objects, and zero users/stories. The export was removed after verification. Time Travel returned a current bookmark. This tests snapshot readability and schema recovery, not a destructive rollback of the serving database or full live-media disaster recovery.

## GitHub

Use a dedicated private repository containing this product directory only. Do not publish the surrounding personal context repository. Push the `codex/initial-product` branch for review. `.github/workflows/check.yml` runs type checks, application tests, build and isolated Cloudflare integration tests without cloud secrets or paid model calls.

Connect the repository to Cloudflare Workers Builds after selecting the actual account and worker. Keep staging and production as distinct workers and bindings. Preview builds must use staging resources. Production publication remains an explicit reviewed release, not an automatic consequence of opening a pull request.

## Google setup

The application already uses Better Auth with Google. Client credentials are still required; deployment and a domain purchase do not create them automatically. Keep TaleRelay separate from the existing ToolMoss consent branding.

For local development, create a **Web application** OAuth client and register the exact callback `http://127.0.0.1:5178/api/auth/callback/google`. Supply `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and a local `BETTER_AUTH_SECRET` through the approved secret mechanism, not tracked files. Keep PUBLIC_ORIGIN consistent with that origin. A local end-to-end test still contacts real Google and needs a reachable Google account; fixture login is not OAuth evidence.

The hosted staging callback is `https://app.tailrelay.com/api/auth/callback/google`. If the domain changes later, add the new exact callback and align PUBLIC_ORIGIN, Google app links and Turnstile hostnames before switching traffic. Keeping the same database preserves account IDs and stories; cookies require a fresh sign-in on the new domain.

[Google web-server OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server) documents loopback callbacks for testing and exact redirect-URI matching. Domain registration, public consent/branding review and a tested login are separate steps.

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

The existing Cloudflare MCP connection provisions resources. Wrangler device login completed, and the selected account matches the resource account. Credentials are stored in an encrypted Wrangler configuration protected by macOS Keychain. The initial automated browser-opening action was denied; no browser-policy workaround was used. Never copy OAuth tokens into the repository.

## Storage drill — 2026-09-07

A disposable 58-byte object in a random staging `ops-drill/` prefix was uploaded, downloaded as a backup, restored to a second key and downloaded again. Both copies matched SHA-256 `0d772a6194f7151d0051c9044f6f22fc77082404cbd59410f3cabe8f7d1c0c21`; both remote objects and local temporary files were then removed. No user object was touched. This verifies the object transfer/recovery procedure; an independently retained media backup and deletion-replay process still need to be configured before production.

## Controlled staging and source delivery

Apply migration `0020_generation_access.sql` before deploying the dependent Worker. New environments restrict all model calls to explicitly admitted testers; an administrator role alone is insufficient. Local fixtures explicitly opt out of the restriction. Apply environment-specific budgets and tester admission through authorized operations, not a committed live-account SQL seed.

`release.acceptance.json` is intentionally ignored. Keep the dated authorization and operating evidence in the operator's private records; copy the reviewed acceptance file locally only for the intended environment. The tracked Wrangler configuration remains generation-disabled by default. Never treat a repository clone or CI success as production acceptance.

The existing GitHub repository is public and contains the product only. Keep the parent context repository, credentials, actual billing balances and private request records outside it. Publish the product commit before updating its parent submodule pointer. See [the engineering validation summary](STAGING-VALIDATION.md) for the code and tests.
