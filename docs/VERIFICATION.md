# Verification and release status

Updated 2026-09-07. The empty staging website is deployed at `https://app.tailrelay.com`, with login, generation and payment still closed pending configuration. Local fixture tests and isolated real provider experiments remain separate from public canon. Later dated entries below supersede historical counts. See [provider experiments](LIVE-PROVIDER-TESTS.md) and [the latest editor acceptance](DIRECTOR-ACCEPTANCE.md).

See the [prioritized product completion checklist](PRODUCT-STATUS.md) for implementation work and account/configuration dependencies.

## Verified locally

- Current pass: 63 unit/database/HTTP contract tests, TypeScript and frontend build. The isolated Cloudflare integration suite passed 17 API subtests (18 including its parent). The latest editor changes include six focused parser, cast, audit, accounting and stream tests.
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

Staging static preflight and deployment passed. The latest deployed Worker bundle is 2675.73 KiB, gzip 468.42 KiB, with 67 ms measured startup. Its 7 uploaded assets exclude all fixture footage/art and source maps. Production remains blocked on its origin, policies, protection and acceptance gates. The local network could not reach the workers.dev hostname, so public HTTP and Google sign-in acceptance are not claimed.

Remote D1 acceptance: schema initialization initially failed with `incomplete input`; the server-side splitter interpreted unparenthesized CASE/END inside triggers incorrectly. Parenthesizing those expressions without changing their meaning resolved the failure ([Cloudflare issue](https://github.com/cloudflare/workers-sdk/issues/4727)). Local migration/ledger tests still passed. Both remote environments then applied 17 migrations successfully; read-back confirmed zero users/stories/scenes, generation disabled and authorization ceiling zero. Earlier local databases do not need their applied history rewritten: the parentheses change preserves the SQL behavior. No existing remote application data was present or deleted.


TaleRelay identity acceptance: 43 application/DB/contract tests and 16 reported isolated Worker integration tests passed after the rename and policy version bump. Type checks passed after adding the real staging Turnstile site key. Browser inspection confirmed the TaleRelay title, navigation and footer; no draft terms were accepted. Earlier accepted policy text remains immutable in D1.

Support contact acceptance: the supplied Proton mailbox is present in all environment configurations, the legal contact section and site footer. Browser inspection verified the exact mailto address and TaleRelay Support label. The privacy test now distinguishes the intentionally public support email from private account emails; all 43 application checks and 16 reported isolated integration tests passed. The staging update deployed successfully. No test email was sent, and inbox delivery has not been independently verified. Operator identity disclosure remains pending.


## Account-record export (2026-09-06)

`npm run check` passed: type checking, 46 application tests and the Vite build. `npm run test:integration` passed all 17 reported tests in an isolated local Workers runtime/database, including the new export test across every section and more than 205 notification records. Authentication, origin checks, account switching, explicit field exclusions, exact policy documents, page completeness, cancellation and byte ceilings are covered. The staging static preflight and deploy dry run passed. No paid provider or Paddle call was made.

See [account export](ACCOUNT-EXPORT.md) for included/excluded records and limits. Browser-rendered UI/download acceptance is still pending: automatic browser approval rejected access to the entire local origin. No alternate browser or indirect browser access was attempted. This does not constitute real Google login, live payment or completed account-deletion acceptance.

The account-export iteration was deployed to the existing staging Worker as version `02a313c4-4cbc-4bba-8000-f6fa2e2e05d9`. Two updated static assets were uploaded; existing fixture exclusions remain in force. Generation, checkout and development login remain disabled. Public HTTP and browser UI acceptance remain outstanding as noted above.

## 2026-09-07 deployment iteration

- `npm run check`: typecheck/build and **57 tests passed**. Subsequent streaming cleanup/poll scheduling changes passed the focused speech suite.
- `npm run test:integration`: **17 API subtests passed** (18 runner tests including the parent) in a disposable local Cloudflare runtime. Includes account deletion/private responses/session revocation. No remote fixture seeding.
- Real speech integration: both existing Turbo text clips completed using the same Worker code with durable local test bindings; one low-confidence result correctly required manual review. See [provider results](LIVE-PROVIDER-TESTS.md).
- Remote D1: 19 staging migrations applied; 18-migration snapshot restored offline with clean integrity and foreign keys. Time Travel bookmark read successfully. Remote R2 disposable backup/restore bytes matched and were removed.
- HTTPS custom domain: `app.tailrelay.com` serves the staging Worker. fal/DeepSeek credentials were securely provisioned; no provider secrets or sample footage were uploaded as public assets. Static `_headers` now supplies CSP, framing, referrer and content-type protections plus immutable caching for hashed assets.
- Remaining evidence: actual Google OAuth/Turnstile user interaction, a multi-scene cloud generation/recovery run, mobile/network playback, live alert delivery and independently retained media backups, finalized policies, and authenticated Paddle sandbox checkout/refund acceptance. Browser automation opened the deployed discovery page but timed out on inspection; that is not a passed browser test. GitHub CI status must be read separately after push.

Public smoke checks passed for home/discover/share HTML, CSP/nosniff headers, health/bootstrap, private admin/transcript/export endpoints, unknown API routing, disabled developer sign-in and cross-origin rejection: **12 endpoint checks**. This remains a staging preview, with zero remote users/tasks and real login/creation/payment switches closed.

## 2026-09-07 independent continuity audit

The story editor/cast/response-reader fixes and independent continuity audit deployed as Worker version `54022ff2-3e95-4dbb-8e2d-6c25aaf10f85`: 2700.51 KiB upload, 474.72 KiB gzip, 76 ms startup. All 63 application tests, typecheck/build and staging preflight passed. The 17 API integration subtests passed during this iteration; later bounded response-buffer handling passed its focused and full unit suites. See [real editor acceptance and retained failures](DIRECTOR-ACCEPTANCE.md).

Post-deploy checks passed for discovery HTML/current assets/CSP, health, anonymous bootstrap and admin rejection (four endpoints). Python's default user agent received Cloudflare error 1010; the explicitly identified `TaleRelay-Readiness/1.0` client passed without a security-rule change. [Cloudflare documents 1010 as a browser-signature block](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/). This does not prove interactive browser/mobile acceptance: the automated Edge preview tab remained blank/asleep during inspection.

Google branding and the minimal Paddle Sandbox setup-key form are prepared, pending the requested policy/key approvals. No OAuth client or Paddle key/catalog was created, and no live purchase or new video was attempted. Staging still has no remote stories or users; production release gates remain closed.
