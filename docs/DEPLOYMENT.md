# Cloudflare deployment

The owner has supplied a dedicated GitHub repository for this product. No Cloudflare resources have been provisioned by this implementation. The tracked configuration deliberately contains invalid remote resource placeholders, and preflight prevents accidental deployment with them.

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
