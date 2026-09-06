# Verification and release status

Updated 2026-09-06. Local implementation only; no paid model generation or cloud deployment has been performed.

## Verified locally

- TypeScript checks and production frontend build.
- Cloudflare Worker dry-run bundle: about 2.5 MiB uncompressed, 442 KiB compressed at the initial dry run.
- Real Wrangler/D1 migrations, including trigger parsing. A Wrangler SQL splitter incompatibility in compact CASE expressions was found and fixed.
- SQL transaction tests: duplicate admission, independent stories, atomic canon publication, stale parent rejection, permanent author ownership, cancellation across a UTC reset, in-flight uncertain cost reservations, provider freshness, lifetime ceilings and chapter boundaries.
- Isolated local Worker integration: first sign-in nickname, email privacy, normalized nickname collision, concurrent idempotent drafts, FIFO Workflows, independent parallel stories, actual-content approval, changed-canon review, refunds, cross-story access rejection, author share metadata, account request visibility, material approval permissions and versions. The fixture Workflows reach `complete`.
- Browser acceptance in the running app: desktop story page, first-login nickname, preview/attribution confirmation, submission status/credit update, story switching, mobile layout/navigation and tap-to-open prompt/author cards.
- Fixture MP4 duration is probed from metadata without reading the video payload into memory.

The executable tests are the source of truth for current counts. Run `npm run check` and `npm run test:integration` after changes. Browser regression specs have been authored; their separate Playwright runner has not yet been executed in this development session. Browser interactions were checked through the actual app instead.

The local Workflow emulator emitted a hung-request diagnostic around its sleep wake-up. The database transitioned correctly and the Workflow status API reported completion. This emulator diagnostic is recorded rather than treated as proof of a production failure; remote sleep/resume acceptance remains required.

## Not yet verified or delivered

1. Real Google login/callback and account recovery behavior on the final origins.
2. Paid fal and director calls, effective prices, latency and measured cost per accepted clip. The current H3 cost-floor guard includes output, previous video and voice inputs; it is not a complete quote. Image dimensions, reference delivery stability and current rates must be verified to establish a conservative request ceiling. The 150-cent fixture reserve is insufficient for a ten-second 768P continuation with ten seconds of reference footage.
3. English speech/OCR validation, faces and voices across at least ten clips, returning characters, new-character entrance and smooth causal/visual transitions.
4. Production media ingestion, adaptive Stream playback or FFmpeg episode packaging, complete chapter playback and archive recovery. Current player switches MP4 clips and cannot promise a gapless real-media episode.
5. Owned ingestion/validation of character reference assets, public abuse controls such as Turnstile, incident alerts and provider billing reconciliation.
6. Dedicated owner approval before expensive major world/character changes. The director currently flags intent changes and every publication requires a studio reviewer; the separate pre-generation owner approval policy still needs enforcement.
7. Full account deletion execution and confirmed retention policy, operator contact, backup restore drill and published legal policies.
8. Provisioned Cloudflare environments, a successful remote GitHub CI run, actual deployed-domain smoke tests and production release approval.

These are release gates, not optional claims of completed work. `release.acceptance.example.json` deliberately starts unchecked and deployment preflight prevents publishing the placeholder configuration.
