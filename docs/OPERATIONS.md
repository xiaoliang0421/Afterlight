# Operations

## Opening or pausing creation

Studio → Capacity & settings controls admission within the separately authorized spending ceiling. Pausing admission keeps published stories watchable. A story owner can pause only their own world. Already submitted external requests require reconciliation; pausing the website does not cancel provider billing.

Local fixture wallet values are simulated and labeled. They are not a real account balance. Free credits and prices in development are test settings, not a launch pricing commitment.

## Reviewing a scene

1. Open Studio → Review queue → Watch & review. Watch the entire stored clip.
2. Verify English speech, narration/lyrics and readable text, character continuity, causal transition and content suitability.
3. Write the actual scene summary and events. Do not copy proposed events when the footage did not show them.
4. Provide reviewed WebVTT captions matching the actual audio, or confirm no dialogue. Confirm only candidates who actually appear; update character state only for events shown.
5. Publish once. The database rejects stale parent versions and duplicate scene versions. On rejection, user credit returns while platform cost stays recorded.

No automatic ASR/OCR or visual consistency pass exists yet. Manual review is mandatory in the current implementation. Real model quality testing is still outstanding.

## Character materials

Studio → Character materials lists existing characters and planned candidates. Review the source image and optional 2–5 second voice sample before approving their stable HTTPS URLs. Use material whose rights permit the intended use. Each reference edit has an audit trail. A model-generated URL is never accepted as an approved reference automatically.

Ingestion and validation of these reference files into owned storage is still a launch task. Avoid transient signed URLs that will expire before generation or recovery.

## Stopped or uncertain tasks

- `NeedsReview`: the author can review and rejoin at a new queue position, or withdraw.
- `NeedsModeration`: inspect the stored original; do not regenerate merely because a playback derivative fails.
- `ReconciliationNeeded`: verify the provider request and charge. If a request ID is recorded, use **Resume known request** to poll/archive that request. Do not issue another paid POST. If the attempt outcome is unknown, investigate with the provider first.
- **Fail after verification** requires the actual reconciled upstream cost before releasing reserved funds. Never enter zero just to free the queue.

Attaching a recovered external request ID when the original response was lost is not yet supported in the studio UI. That case requires a reviewed database repair and remains a launch acceptance item. Old-day tasks retain their original budget periods.

## Reports and account requests

Story reports appear in Studio → Reports. Hiding a scene leaves an explicit timeline placeholder and pauses that story for editorial review. Hidden media cannot be fetched through its normal scene endpoint, and hidden prompt text is redacted from story responses.

Account deletion requests appear in Studio → Account requests with private contact details. A request can be withdrawn by its owner. The UI does not claim an account is deleted when a request is submitted.

The full deletion execution policy is a remaining launch item: verify identity, reconcile unfinished tasks, settle reservations, decide lawful retention, anonymize public bylines where required, remove private profile data and Better Auth sessions/accounts, and record the request outcome. No automatic destructive account purge is exposed by this build.

## Recovery, backups and rollout

Periodic Workers recovery wakes durable queues and unsent outbox events. Observability records request IDs, safe error codes and task audit actions rather than secrets or full user prompts.

Before production, configure and test D1 recovery plus durable R2 media backup/version retention. A code rollback does not undo a database migration or restore deleted media. Keep migrations compatible with the prior release or schedule a reviewed data migration. Provider/media failures must never reset a task to a blind paid retry.
