# Afterlight

An English-language, collaboratively written video serial. Viewers submit ideas; each story has its own FIFO queue, cast, canon and archive. Every published scene credits the person behind the idea.

**Status: working local product implementation; not ready for public launch.** The starter worlds and playback clips are clearly marked development fixtures. They do not demonstrate the quality or latency of a real video model. The name Afterlight is provisional.

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
- Per-scene byline, hover/focus/tap provenance cards, original and English prompts, scene credits and share links to individual contributions. Shared story metadata includes the scene author.
- Preview, explicit attribution consent, versioned approval, atomic quota/cost admission, per-story FIFO execution, recheck after canon changes and persistent contribution statuses.
- Durable Workflows, asynchronous provider polling, R2 archive and range delivery, actual MP4 duration probing, manual actual-content approval and atomic canon publication.
- Candidate-character materials, approved images/optional voice references, material version history and a snapshot of references used for each real model request. New characters become canon only on publication.
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

Real Google OAuth, paid model calls, production media processing, infrastructure resources and remote deployment require the remaining configuration and acceptance work. Never turn an unchecked item in `release.acceptance.example.json` into a passing result merely to get through preflight.

The real provider adapter targets fal's `minimax/h3-max/reference-to-video`. It is implemented but has **not been tested against a paid account**. Character consistency and English speech are quality requirements, not guarantees supplied by IDs or prompt text.

Stream ingestion, adaptive transcoding and FFmpeg episode packaging are not implemented yet. Current playback sequences archived MP4 clips; chapter boundaries and attribution use their actual durations. Smooth playback across a large real-media chapter remains a launch gate.

See [architecture](docs/ARCHITECTURE.md), [deployment](docs/DEPLOYMENT.md), [operations](docs/OPERATIONS.md) and [remaining acceptance work](docs/VERIFICATION.md).
