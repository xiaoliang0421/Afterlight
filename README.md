# TaleRelay

An English-language, collaboratively written video serial. Viewers submit ideas; each story has its own FIFO queue, cast, canon and archive. Every published scene credits the person behind the idea.

**Status: working local product and deployed Cloudflare staging; not ready for public launch.** The starter worlds and playback clips are clearly marked development fixtures. They do not demonstrate the quality or latency of a real video model. The selected live route is H3 Max Turbo text-to-video; character pictures are optional display assets, not model inputs. The public brand is TaleRelay (a storytelling relay); existing infrastructure and persisted identifiers retain the internal Afterlight name.

Staging: **https://app.tailrelay.com**. Google sign-in is pending; creation, checkout and development login are disabled. Deployment, scheduled D1 health and public HTTP checks passed; interactive login and complete website generation/payment acceptance remain pending. The old workers.dev endpoint is disabled.

**Continue here:** [remaining engineering plan / 剩余工程计划](docs/ENGINEERING-PLAN.md) lists priorities, ownership, dependencies, acceptance criteria and the remaining test budget. See [launch identity](docs/LAUNCH-IDENTITY.md) for the name, operator and mailbox handoff.

## Run locally

Use Node 24 LTS and npm. Node 23.11 was also used for local verification.

```sh
npm ci
npm run build
npm run db:migrate
npm run db:seed
```

Run these in two terminals:

```sh
npm run dev:api
```

```sh
npm run dev
```

Open `http://127.0.0.1:5178`. Sign-in offers three **local-only** test identities: storyteller, first-time user and studio administrator. No credentials or paid services are needed for fixture mode. Seeding is strictly local; never send `fixtures/seed.sql` to a remote database.

The local studio account can watch and approve fixture scenes. The reviewer must describe what the footage actually shows. Fixture clips remain labeled after publication.

## Implemented

- Discover, story switching, new-world wizard, private drafts, owner-controlled opening/pausing, saved stories and per-story watch progress.
- Better Auth with Google and D1 integration; first-login nickname setup, duplicate/reserved-name checks, public contributor profiles, private account email, account-request inbox.
- Dedicated draft Terms and Privacy pages, explicit versioned acceptance before creation, archived policy text, private downloadable acceptance records and per-submission attribution/plan consent. Final operator details and legal review are still pending.
- Per-scene byline, hover/focus/tap provenance cards, original and English prompts, scene credits and share links to individual contributions. Shared story metadata includes the scene author.
- Preview, explicit attribution consent, versioned approval, atomic quota/cost admission, per-story FIFO execution, recheck after canon changes and persistent contribution statuses.
- Private major-change proposals and creator decisions, bound to the exact plan and canon version, with separate contributor admission and no generation reservation while waiting.
- Durable Workflows, asynchronous provider polling, R2 archive and range delivery, actual MP4 duration probing, manual actual-content approval and atomic canon publication.
- Full fixed character descriptions and latest state appended to each text-only video request, with an exact request identity snapshot. New characters become canon only on publication. The previous reference adapter and curated image/voice materials remain non-default capabilities.
- Optional existing-cast picker with saved story-scoped IDs; publication-driven character history, source-backed story-guide drafts and studio review before those guides become public.
- Free launch policy, UTC credit periods, global daily/monthly/lifetime ceilings, provider-balance freshness checks, cancellation/refund accounting, uncertain-request reconciliation and disabled checkout.
- Responsive player with chapters, captions, seek, replay/resume, scene attribution, reports and admin operations.
- Separate Cloudflare staging/production configuration, deployment preflight and GitHub CI checks.

## Checks

```sh
npm run check
npm run test:integration
npm run deploy:check -- staging
```

Integration tests create an isolated temporary local D1/Worker environment on port 8790 and remove only that test environment afterward. They exercise the real local Cloudflare runtime and fixture Workflow, including publication and author rename. Deployment preflight intentionally fails until actual resource IDs and origins are configured.

Browser regression specifications are in `tests/browser/`; with the two preview servers running and Playwright Chromium installed, run `npm run test:e2e`. The initial development session used browser-driven manual acceptance for the actual screens. See [verification](docs/VERIFICATION.md) for the exact distinction between checked and unchecked behavior.

## Before launch

Real Google OAuth, end-to-end live website generation, production media processing, infrastructure resources and remote deployment require the remaining configuration and acceptance work. Isolated paid provider checks are documented in [live experiments](docs/LIVE-PROVIDER-TESTS.md); [character image preparation](docs/CHARACTER-IDENTITY.md) tracks implemented and pending work. Never turn an unchecked item in `release.acceptance.example.json` into a passing result merely to get through preflight.

The default adapter targets fal's `minimax/h3-max-turbo/text-to-video`; the paid reference path retains `minimax/h3-max/reference-to-video`. Both routes have isolated real sample results, but the live website fulfillment flow has not yet passed end-to-end acceptance. Character consistency and English speech are quality requirements, not guarantees supplied by IDs or prompt text.

Stream ingestion, adaptive transcoding and FFmpeg episode packaging are not implemented yet. Current playback sequences archived MP4 clips; chapter boundaries and attribution use their actual durations. Smooth playback across a large real-media chapter remains a launch gate.

See [architecture](docs/ARCHITECTURE.md), [deployment](docs/DEPLOYMENT.md), [operations](docs/OPERATIONS.md) and [remaining acceptance work](docs/VERIFICATION.md).

## Free and paid creation

Text-to-video is the limited free route; H3 Max reference-guided generation remains in the code as a paid option. Tasks bind their mode/model/quote before queueing. The Paddle checkout adapter, verified webhook reconciliation, separate purchased-point ledger and account order UI are implemented. Real checkout, active point packages and paid reference generation are disabled until merchant setup, sandbox acceptance and fulfillment verification. See [payments](docs/PAYMENTS.md).
