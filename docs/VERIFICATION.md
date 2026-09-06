# Verification and release status

Updated 2026-09-06. The local website remains in fixture mode. Four isolated real DeepSeek calls and four real fal videos (two reference, two text-only) plus two reference-clip speech checks have completed; no cloud deployment has been performed. See [the complete test scope and limitations](LIVE-PROVIDER-TESTS.md).

See the [prioritized product completion checklist](PRODUCT-STATUS.md) for implementation work and account/configuration dependencies.

## Verified locally

- TypeScript checks and production frontend build.
- Major-change owner decisions: explicit private sharing, owner-only access (no administrator override), immutable exact-plan/version decisions, duplicate request protection, no video credit reservation while waiting, withdrawal/rejection, plan/canon invalidation, and admission/provider-start database guards. Local HTTP tests cover approval through the fixture Workflow and return of the generation credit. Browser inspection covers the creator inbox entry and its empty state; a populated decision modal has not received browser end-to-end acceptance.
- Local Paddle contract tests: raw-body HMAC, replay rejection, transaction/order/amount/currency matching, duplicate notifications, current-state reconciliation, partial/full refunds, dispute holds, point reservations, immutable mode/quotes, and uncertain checkout creation. These use mocked Paddle responses, not a real Paddle sandbox account.
- The account and composer show separate free allowances / purchased points, mode differences, empty order history and a closed checkout.
- Cloudflare Worker dry-run bundle: about 2.5 MiB uncompressed, 442 KiB compressed at the initial dry run.
- Real Wrangler/D1 migrations, including trigger parsing. A Wrangler SQL splitter incompatibility in compact CASE expressions was found and fixed.
- SQL transaction tests: duplicate admission, independent stories, atomic canon publication, stale parent rejection, permanent author ownership, cancellation across a UTC reset, in-flight uncertain cost reservations, provider freshness, lifetime ceilings and chapter boundaries.
- Isolated local Worker integration: first sign-in nickname, email privacy, normalized nickname collision, concurrent idempotent drafts, FIFO Workflows, independent parallel stories, actual-content approval, changed-canon review, refunds, cross-story access rejection, author share metadata, account request visibility, material approval permissions and versions. The fixture Workflows reach `complete`.
- Browser acceptance in the running app: desktop story page, first-login nickname, preview/attribution confirmation, submission status/credit update, story switching, mobile layout/navigation and tap-to-open prompt/author cards.
- Policy APIs: refusing or submitting an obsolete/false acknowledgment cannot open creation; acceptance is idempotent, private and tied to archived exact text. Attribution consent is recorded with the actual queue sequence and approved scene plan.
- Story-guide Workflow: one private candidate per published version; source and character validation; administrator review; immutable approved versions; historical playback limits. Public archive pages and scene-link copying were checked in the browser.
- Optional cast selection: stored IDs, per-story/introduced-character validation, idempotency conflicts, immutable selections and fixture director input. Browser selection and saved per-story choices were checked separately from submission consent.
- Fixture MP4 duration is probed from metadata without reading the video payload into memory.

The executable tests are the source of truth for current counts. Run `npm run check` and `npm run test:integration` after changes. Browser regression specs have been authored; their separate Playwright runner has not yet been executed in this development session. Browser interactions were checked through the actual app instead.

The local Workflow emulator emitted a hung-request diagnostic around its sleep wake-up. The database transitioned correctly and the Workflow status API reported completion. This emulator diagnostic is recorded rather than treated as proof of a production failure; remote sleep/resume acceptance remains required.

## Not yet verified or delivered

1. Real Google login/callback and account recovery behavior on the final origins.
2. End-to-end live website generation, billing reconciliation and measured cost per accepted clip. The isolated paid tests do not prove this complete flow. The current H3 cost-floor guard includes output, previous video and voice inputs; it is not a complete quote. Image dimensions, reference delivery stability and current rates must be verified to establish a conservative request ceiling. The non-default reference route needs more than the 150-cent fixture reserve for a ten-second continuation with ten seconds of reference footage. The selected Turbo text route validates its regular US$0.40 ten-second output cost independently.
3. English speech/OCR validation, faces and voices across at least ten clips, returning characters, new-character entrance and smooth causal/visual transitions.
4. Production media ingestion, adaptive Stream playback or FFmpeg episode packaging, complete chapter playback and archive recovery. Current player switches MP4 clips and cannot promise a gapless real-media episode.
5. Public abuse controls such as Turnstile, incident alerts and automatic provider billing reconciliation. In-site image generation, appearance confirmation and owned reference ingestion are deferred from the pure-text video path. See [character identity workflow](CHARACTER-IDENTITY.md).
6. Live evaluation of major-change classification across languages and adversarial proposals. Owner approval enforcement is implemented locally; the editor's semantic classification and conservative English backstop are not a guarantee that every change is detected. Unplanned changes in generated footage must still be rejected during content review.
7. Full account deletion execution and confirmed retention policy, operator identity/contact, public age eligibility, regional legal review and backup restore drill. Draft privacy/terms pages and acceptance records are implemented; they are not finalized public policies.
8. Actual Paddle sandbox checkout, declined card, webhook delivery, refund/reversal handling, approved merchant/catalog/settlement details and paid-reference fulfillment. Paddle adapter and local accounting exist; real payments remain disabled.
9. Provisioned Cloudflare environments, a successful remote GitHub CI run, actual deployed-domain smoke tests and production release approval.

These are release gates, not optional claims of completed work. `release.acceptance.example.json` deliberately starts unchecked and deployment preflight prevents publishing the placeholder configuration.
