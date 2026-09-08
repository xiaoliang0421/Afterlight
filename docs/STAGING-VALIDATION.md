# Controlled staging validation

## Runtime and access controls

Cloudflare workerd rejects `redirect: "error"` before making an outbound request. The affected adapters now use `manual` and reject non-2xx responses. A native Miniflare test verifies successful form serialization, no following of a secret-bearing redirect, upstream failure and hostname rejection. No real credentials or paid model calls are used by these tests.

Migration 0020 restricts preview, video, speech and archive calls to admitted test accounts. It also checks queue admission and the durable video-attempt marker. An administrator is not implicitly admitted; revocation does not prevent cancellation or reconciliation of an existing request. New database tests verify denial without partial budget/ledger mutations.

## Fixed story setting and style

A real staging clip showed daylight and photorealistic rendering despite the saved night setting and hand-painted style. It was rejected and its creation credit returned; it did not become published story history. The request used only the director shot, cast and bridge, omitting the fixed world rules and style.

Text-video preparation now reads these two fields from the story, prepends them to the final prompt and records them in the material snapshot. The regression uses a plan that omits both fields, fails before the fix and passes afterwards. Prompt inclusion does not guarantee model compliance; the next clip still needs visual and complete audio/text review.

## Completed-video cost review

Studio provides a separate **Check video cost** action for a completed real video awaiting moderation. An administrator verifies the exact provider request, enters the video-only USD charge (fractional cents rounded up), records billing evidence and explicitly confirms the review. Planning and speech charges remain separate.

The cost and its audit receipt are written in one D1 transaction. The full reservation remains held until normal moderation settles the task. Identical retries preserve one receipt, conflicting reviews fail, and moderation that wins the race prevents a late cost adjustment. Fixture footage, unknown requests, inactive reservations and charges above the reservation cannot use this action. Investigate overruns separately; this action does not rewrite already settled ledgers.

Seven tests cover permissions, validation, rejection settlement, retries, conflicting reviews, moderation races and transaction rollback. An isolated browser check submitted a synthetic verified charge through the actual Studio form and confirmed the updated amount and removal of the review action. Hosted deployment of this new action still needs verification.

## Verification and delivery

- TypeScript, frontend build and 78 application/database/runtime tests passed.
- Isolated Worker/D1 integration passed 19 API subtests (20 runner tests).
- Eight credential-helper tests passed, including separate ADMIN storage, safe child environment and redacted error output.
- Worker dry-run bundling and staging preflight passed.
- Hosted login, story/draft creation, preview, admission, video/R2 ingestion, speech check and rejection/credit return were exercised. Successful accepted publication, longer-story consistency and production release are still pending.

Actual account details, provider request IDs, authorization, billing and operational SQL stay in private operator records. The public repository keeps implementation, synthetic tests and this technical summary. GitHub CI verifies the pushed source; dashboard code patches do not by themselves prove that every source change is deployed.
