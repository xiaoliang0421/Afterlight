# Account deletion

Implemented 2026-09-07. Local fixture/runtime verification is separate from legal approval. Hosted execution requires final policies.

## Processing a request

1. The authenticated owner submits or withdraws a request in Account. Studio responses remain private and are shown in Account.
2. A separate studio administrator previews the account and blockers. Admin accounts must transfer their role first. Active work, uncertain charges, purchased balances, open payment requests and open reports must be resolved before deletion.
3. Review identifying content in published scenes, story/cast/archive text, reference materials and other support records. Handle necessary content removals through moderation before acknowledging that review.
4. Submit the exact account ID, current policy version, content-review acknowledgment and typed confirmation. D1 checks current conditions again and commits all database changes atomically. Repeated execution returns the same completed receipt.

## Data treatment

- Removed: profile email/nickname, Google-linked account/session records, local development sessions, favorites, watch progress, notifications, free wallet and settled empty purchased wallet, private task prompts/plans/material snapshots and stored provider inputs.
- Anonymized: the stable public author is displayed as Deleted storyteller; published original prompts are redacted. Existing playback retains its scene IDs and timeline positions. Owned stories are paused.
- Queued for R2 cleanup: unpublished original videos and captions at exact owned task paths. Cleanup rechecks published references, retries failures, and records completion. It does not delete published playback media.
- Retained for reviewed purposes: minimal provider request/attempt IDs and costs, purchase/ledger records, exact policy versions and acceptance records, anonymized shared story content, and a deletion receipt. Final retention periods are not yet approved.

The account-ID tombstone cannot be revived by a stale authenticated request. A later new Google registration has a new account identifier and does not reconnect old contributions. A provider’s own retention and backups are not automatically erased by this transaction. After a backup restore, replay all deletion receipts and repeat pending media cleanup before serving traffic; the recovery runbook must be validated before public launch.

## Verification

Automated tests cover authorization, changed/withdrawn requests, active/uncertain generation, billing blockers, atomic rollback under a concurrent change, immutable provider IDs, private-media cleanup retry, duplicate execution, revoked sessions and isolation from other accounts. All fixtures use a disposable local database; never run fixture files against remote D1.
