# Connecting real services

Checked against the provider documentation on 2026-09-06. No live keys, charges, or paid model tests are included in the local preview.

## What already works

Afterlight's own APIs, D1 storage, story queues, account profiles, author attribution, quota accounting and studio approval run in the local Cloudflare runtime. The video and story-editor adapters exist, but the current preview deliberately uses labeled playback fixtures. An adapter is not evidence that a provider account, balance, model quality or production deployment has been verified.

## Account setup

| Service      | Owner action                                                                                                       | Implementation action                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| fal          | Sign in, review H3 availability, add a small prepaid balance when ready, choose a separate test spending ceiling   | Configure video calls, read balance, validate reference-input pricing, run bounded tests and archive media |
| Story editor | Reuse an existing compatible API account or create a DeepSeek account; confirm an available model and test balance | Configure English scene adaptation and execution-time continuity checking                                  |
| Cloudflare   | Select the existing account and authorize any required service activation or spending                              | Provision isolated staging resources, store secrets, apply migrations and deploy the application           |
| Google OAuth | Authorize access to the existing Cloud project or create a project/client                                          | Configure origins and callback URLs, test Google sign-in and mandatory public nickname                     |

Registration, identity verification and payment details stay with the owner. Routine configuration and integration can be completed after access is authorized. Purchasing credits is separate from approving any particular amount for this test; automatic recharge is not needed.

## fal steps

1. Sign in at [fal](https://fal.ai/). Open the [H3 Max reference-to-video model](https://fal.ai/models/minimax/h3-max/reference-to-video) to confirm that the intended endpoint is available to the account. Do not click Run until a test budget is approved.
2. Open [Billing](https://fal.ai/dashboard/billing) and inspect the available top-up amounts. fal uses prepaid credits; use a small initial deposit that fits the intended test, and leave automatic recharge off. The actual checkout determines supported payment methods and minimum deposit.
3. Open [API keys](https://fal.ai/dashboard/keys). Create an API-scoped key for `FAL_KEY`. Current balance access requires a separate ADMIN-scoped key for `FAL_ADMIN_KEY`; keep that broader key exclusively on the server.
4. Enter keys directly into the staging Worker's Cloudflare Secrets. Do not send the values in chat or commit them. Local fixture testing requires no keys.
5. Verify account balance, endpoint access and rates through read-only requests first. Set the application lifetime/day/month ceilings and a conservative per-task reservation before enabling a paid generation.
6. Start with one approved ten-second scene. Record its actual cost, wait time, English speech and references. Only then test several consecutive scenes and a new-character entrance within the remaining authorization.

## Story editor

The adapter uses the Chat Completions JSON format and accepts a configurable HTTPS endpoint/model. The current DeepSeek default is `deepseek-v4-flash`; it has not been tested with a real account in this project. An existing compatible provider can be used after verifying its JSON behavior, context limits, prices and generation rules.

For DeepSeek, obtain an API key from its [API platform](https://platform.deepseek.com/) and store it as `DIRECTOR_API_KEY` in Cloudflare Secrets. Confirm that this is an API account with usable API balance; a consumer chat subscription does not configure Afterlight's API automatically. The application currently records a conservative director-call allowance before each request; validate that allowance against the selected model and bounded prompt/output size before enabling it.

## Cost example, not a quote

The H3 model page currently lists $0.08 per generated second. Ten seconds of output is $0.80, but a ten-second reference video at 768P adds approximately $1.41 before image/voice inputs change the pooled reference charge. So a continuation can already be about $2.21 before those additional inputs, the story editor or rejected/repeated attempts. This is why the fixture's $1.50 reservation must not be carried into live settings.

A $10 test ceiling is a proposed small connectivity/quality experiment, not a promise of ten clips or enough budget for launch acceptance. Recheck the account's actual price immediately before testing. If there is not enough authorized budget to finish the next complete request, stop admission and keep existing stories playable.

## Login and deployment

The login integration reuses the Better Auth + Google + D1 approach. It does not automatically share another site's sessions, user table or credentials. Google callbacks must match `https://<staging-origin>/api/auth/callback/google` and the separate production origin. Store `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` in the corresponding environment's server secrets.

Use [the deployment procedure](DEPLOYMENT.md) after choosing the account and origins. Generating one real video does not close the remaining release gates: English/identity continuity, reference ownership, full request cost ceilings, long-form playback, abuse protection, privacy operations and recovery still need evidence.

## Sources

- [fal prepaid pricing](https://fal.ai/docs/documentation/model-apis/pricing)
- [fal key scopes](https://fal.ai/docs/documentation/model-apis/authentication/key-based)
- [fal account balance and required ADMIN scope](https://fal.ai/docs/platform-apis/v1/account/billing)
- [H3 output and reference-input prices](https://fal.ai/models/minimax/h3-max/reference-to-video)
- [DeepSeek API setup and current model identifiers](https://api-docs.deepseek.com/)

## Separate fal balance credential

After the operator explicitly approves the ADMIN scope, store its credential separately with `python3 scripts/deepseek-keychain.py --provider fal-admin save`. The `check` action only reads billing; `run node scripts/provision-provider-secret.mjs FAL_ADMIN_KEY` provisions the encrypted staging binding using an already authenticated Wrangler session. The existing video key is preserved. ADMIN is broader than read-only billing, and provisioning does not grant spending authorization. Keep actual keys and account billing evidence outside this public repository.
