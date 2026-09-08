# Controlled staging validation

## Runtime and access controls

Cloudflare workerd rejects `redirect: "error"` before making an outbound request. The affected adapters now use `manual` and reject non-2xx responses. A native Miniflare test verifies successful form serialization, no following of a secret-bearing redirect, upstream failure and hostname rejection. No real credentials or paid model calls are used by these tests.

Migration 0020 restricts preview, video, speech and archive calls to admitted test accounts. It also checks queue admission and the durable video-attempt marker. An administrator is not implicitly admitted; revocation does not prevent cancellation or reconciliation of an existing request. New database tests verify denial without partial budget/ledger mutations.

## Fixed story setting and style

A real staging clip showed daylight and photorealistic rendering despite the saved night setting and hand-painted style. It was rejected and its creation credit returned; it did not become published story history. The request used only the director shot, cast and bridge, omitting the fixed world rules and style.

Text-video preparation now reads these two fields from the story, prepends them to the final prompt and records them in the material snapshot. The regression uses a plan that omits both fields, fails before the fix and passes afterwards. A subsequent real clip included both fields in the provider input and material snapshot, rendered the night setting and 2D style, and passed visual review plus operator-confirmed full audio review. It was published with reviewed English captions and author attribution. Longer-story continuity still needs separate validation.

## Completed-video cost review

Studio provides a separate **Check video cost** action for a completed real video awaiting moderation. An administrator verifies the exact provider request, enters the video-only USD charge (fractional cents rounded up), records billing evidence and explicitly confirms the review. Planning and speech charges remain separate.

The cost and its audit receipt are written in one D1 transaction. The full reservation remains held until normal moderation settles the task. Identical retries preserve one receipt, conflicting reviews fail, and moderation that wins the race prevents a late cost adjustment. Fixture footage, unknown requests, inactive reservations and charges above the reservation cannot use this action. Investigate overruns separately; this action does not rewrite already settled ledgers.

Seven tests cover permissions, validation, rejection settlement, retries, conflicting reviews, moderation races and transaction rollback. An isolated browser check submitted a synthetic verified charge through the actual Studio form and confirmed the updated amount and removal of the review action. The same action was then deployed to staging and used on a real completed request. Readback confirmed one audit receipt, one publication settlement, the verified cost and no remaining reservation.

## Verification and delivery

- TypeScript, frontend build and 89 application/database/runtime tests passed.
- Isolated Worker/D1 integration passed 19 API subtests (20 runner tests).
- Eight credential-helper tests passed, including separate ADMIN storage, safe child environment and redacted error output.
- Worker dry-run bundling and staging preflight passed.
- Hosted login, story/draft creation, preview, admission, video/R2 ingestion, speech check and rejection/credit return were exercised. Accepted publication, public byte-range video delivery, English captions and full desktop playback were also verified. Longer-story consistency, mobile and failure recovery acceptance, and production release remain pending.

Actual account details, provider request IDs, authorization, billing and operational SQL stay in private operator records. The public repository keeps implementation, synthetic tests and this technical summary. GitHub CI verifies the pushed source; dashboard code patches do not by themselves prove that every source change is deployed.

## Resumable media delivery

An anonymous staging probe reproduced a partial response despite a mismatched `If-Range` validator. The Worker now sends the complete current file when a strong ETag does not match, ignores Range for HEAD and unsupported range units, and binds a partial R2 read to the inspected object's ETag. If the object changes during that read, it returns a complete current object with matching metadata. Date validators conservatively receive a full response because this endpoint does not expose a strong Last-Modified validator. This follows [HTTP range semantics](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.5) using [R2 conditional reads](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#conditional-operations).

Six native Workers/R2 scenarios cover full reads and HEAD, bounded/open/suffix ranges, stale or weak validators, invalid ranges and empty files, replacement races, and deletion races. Three scenarios failed against the prior implementation before the fix. These tests use a local R2 bucket and synthetic bytes; they do not prove mobile browser or throttled-network playback acceptance.

## Phone layout and interrupted playback

Browser checks identified overlapping phone captions, loading without a retry when media bytes stop arriving, and fullscreen rejection incorrectly treated as media failure. Controls now sit below the footage, long loading offers a retry at the retained position, and fullscreen rejection leaves ordinary playback available. A loopback-only lab exercises the real Player with incomplete responses, HTTP 503 and paced media bytes. See the [observed results and reproducible acceptance steps](PLAYBACK-ACCEPTANCE.md). Physical devices and throttled real media remain separate release evidence.

## Scheduled recovery and fault visibility

Previously, caught balance and queue errors could leave the scheduled pass marked complete, while an uncaught early-stage failure prevented later recovery work. The reconciler now records separate component results, continues independent work, preserves unsent update records and marks partial failures incomplete. Overlapping passes use both component and parent run IDs to preserve the newest result.

Database-backed failure injection covers unavailable balance reads, one broken story queue, selective update-delivery failure, later cleanup execution, retry after recovery, and older passes finishing after a newer failure in the same millisecond. A separate native Miniflare test runs the actual GenerationWorkflow, StoryRoom, D1 and R2: it records a recovery dispatch but omits its wake-up, then lets scheduled reconciliation resume that exact workflow. The saved original matches the synthetic sample bytes, the original provider/attempt IDs and reservation remain unchanged, and the result stays private awaiting moderation. Repeated reconciliation sends no additional provider requests. All outbound calls are intercepted; exactly three GETs and no paid POST are observed.

This is native local runtime acceptance with synthetic provider responses. It does not claim a real fal outage was induced or a held paid task was recovered on the deployed service. Live outbound alert delivery and actual multi-scene generated continuity remain separate evidence.
