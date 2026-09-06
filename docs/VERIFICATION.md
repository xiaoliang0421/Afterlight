# Verification and release status

Updated 2026-09-06. The local website remains in fixture mode. Four isolated real DeepSeek calls and four real fal videos (two reference, two text-only) plus two reference-clip speech checks have completed; no cloud deployment has been performed. See [the complete test scope and limitations](LIVE-PROVIDER-TESTS.md).

See the [prioritized product completion checklist](PRODUCT-STATUS.md) for implementation work and account/configuration dependencies.

## Verified locally

- Current pass: 43 unit/database/HTTP contract tests, TypeScript and frontend build. The isolated Cloudflare integration suite also passed (16 reported tests including its parent).
- Lost fal response recovery: admin-only verification/linking, exact input/model/time checks, immutable attempt evidence and unique provider IDs, terminal-runtime guard, competing-operator CAS, and persisted recovery dispatch through a simulated dispatcher failure. External calls in contract tests are mocked and assert no generation POST.
- Read-only live verification against an already completed text-video request: fal history returned HTTP 200 with matching endpoint and input payload; queue status returned HTTP 200, matching ID and COMPLETED. No additional model generation was requested. Full deployed recovery remains unverified.
- Turnstile: correct secret destination, exact hostname/action, token length, failed/expired responses, upstream errors and strict local-only fixture bypass. Real widget provisioning and browser challenge acceptance remain pending.
- Playback: actual browser played all three 10-second fixture segments through to 0:30 with scene/time/credit mapping. Added next-clip prebuffering, reload-from-position, HLS recreation, loading/offline states and full-chapter replay. Throttled-network retry and mobile real-media acceptance remain outstanding.
- R2: both configured environment buckets were created. Read-back confirmed r2.dev disabled and no custom domains. No production media or personal context was uploaded.

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
5. Deployed Turnstile challenge acceptance, incident alert delivery and automatic provider billing reconciliation. Turnstile wiring, basic embedding restrictions and local operational diagnostics are implemented. In-site image generation, appearance confirmation and owned reference ingestion are deferred from the pure-text video path. See [character identity workflow](CHARACTER-IDENTITY.md).
6. Live evaluation of major-change classification across languages and adversarial proposals. Owner approval enforcement is implemented locally; the editor's semantic classification and conservative English backstop are not a guarantee that every change is detected. Unplanned changes in generated footage must still be rejected during content review.
7. Full account deletion execution and confirmed retention policy, operator identity/contact, public age eligibility, regional legal review and backup restore drill. Draft privacy/terms pages and acceptance records are implemented; they are not finalized public policies.
8. Actual Paddle sandbox checkout, declined card, webhook delivery, refund/reversal handling, approved merchant/catalog/settlement details and paid-reference fulfillment. Paddle adapter and local accounting exist; real payments remain disabled.
9. A successful remote GitHub CI run, actual deployed-domain HTTP smoke tests and production release acceptance. Staging Worker/Workflows and the five-minute reconciliation cron are deployed; the cron completed successfully against the remote D1 database.

These are release gates, not optional claims of completed work. `release.acceptance.example.json` deliberately starts unchecked and deployment preflight prevents publishing the placeholder configuration.

Staging static preflight and deployment passed. The latest deployed Worker bundle is 2668.30 KiB, gzip 466.39 KiB, with 90 ms measured startup. Its 7 uploaded assets exclude all fixture footage/art and source maps. Production remains blocked on its origin, policies, protection and acceptance gates. The local network could not reach the workers.dev hostname, so public HTTP and Google sign-in acceptance are not claimed.

Remote D1 acceptance: schema initialization initially failed with `incomplete input`; the server-side splitter interpreted unparenthesized CASE/END inside triggers incorrectly. Parenthesizing those expressions without changing their meaning resolved the failure ([Cloudflare issue](https://github.com/cloudflare/workers-sdk/issues/4727)). Local migration/ledger tests still passed. Both remote environments then applied 17 migrations successfully; read-back confirmed zero users/stories/scenes, generation disabled and authorization ceiling zero. Earlier local databases do not need their applied history rewritten: the parentheses change preserves the SQL behavior. No existing remote application data was present or deleted.


TaleRelay identity acceptance: 43 application/DB/contract tests and 16 reported isolated Worker integration tests passed after the rename and policy version bump. Type checks passed after adding the real staging Turnstile site key. Browser inspection confirmed the TaleRelay title, navigation and footer; no draft terms were accepted. Earlier accepted policy text remains immutable in D1.
