# Operations

## Story creator decisions

Story → Story decisions, or Your contributions → Story decisions, shows proposals explicitly shared with the story creator. A studio role alone does not permit deciding for another creator. The creator sees the original prompt, English adaptation, latest visible scene, world rules, selected cast and exact proposed changes; approval and rejection both require a written explanation and review acknowledgment.

Waiting proposals remain outside the generation queue and do not reserve video credits. Editor previews can still incur their separately budgeted model cost. Approval never starts generation automatically: the contributor must confirm attribution and admission. D1 checks an immutable approved record matching the plan revision, exact JSON and canon version at admission and provider start. Plan edits and advancing canon invalidate the approval. Withdrawn, declined and expired requests cannot be approved later; a fresh valid plan requires a new request.

The editor supplies major-change categories and an English keyword backstop adds conservative flags. Neither guarantees semantic detection. Only reviewed footage can advance canon; reject an unexpected death, identity change or contradictory event even if the original plan was approved. Owner decisions do not edit world rules or bypass safety/publication review.

## Opening or pausing creation

Studio → Capacity & settings controls admission within the separately authorized spending ceiling. Pausing admission keeps published stories watchable. A story owner can pause only their own world. Already submitted external requests require reconciliation; pausing the website does not cancel provider billing.

Local fixture wallet values are simulated and labeled. They are not a real account balance. Free credits and prices in development are test settings, not a launch pricing commitment.

## Reviewing a scene

Live preparation first writes a structured proposal, then independently audits every non-rejected plan against current published facts. Contradictions block admission; ambiguous transitions require review. The audit can add owner-decision flags but cannot remove them or approve a rejected plan. Each stage retains its own 25-cent editor cost allowance; invalid output is not automatically retried. This checks proposed text, not the actual generated footage. New-character descriptions become explicit cast anchors, while model-supplied reference URLs are discarded.

1. Open Studio → Review queue → Watch & review. Watch the entire stored clip.
2. Verify English speech, narration/lyrics and readable text, character continuity, causal transition and content suitability.
3. Write the actual scene summary and events. Do not copy proposed events when the footage did not show them.
4. Provide reviewed WebVTT captions matching the actual audio, or confirm no dialogue. Confirm only candidates who actually appear; update character state only for events shown.
5. Publish once. The database rejects stale parent versions and duplicate scene versions. On rejection, user credit returns while platform cost stays recorded.

After a live original is archived, a single Scribe v2 speech check detects language without an English hint and prepares timed caption suggestions. Studio → Watch & review shows the transcript, language confidence, timing issues and a button to copy the draft into the editable caption field. No transcript result checks the publication boxes or publishes automatically. Listen to the whole clip, review every caption, and inspect readable text and visual continuity manually. OCR and automatic visual validation are not implemented.

Speech checks retain a conservative US$0.10 charge against the platform lifetime/day/month ceiling and fal wallet before submission. A unique task attempt prevents duplicate POSTs. Known queue requests are refreshed with GETs; the five-minute cron resumes polling. An uncertain request keeps its cost allowance and can be closed only by a studio operator after verifying the provider has stopped. Closing never resubmits. Missing capacity, oversized/missing media or a provider outage leave the video available for manual review. Originals are streamed from private R2 as a bounded data URI, with no public download URL and no full-video memory buffer. Speech transcripts are included in account export and scrubbed on account erasure; active or uncertain speech checks block deletion.

## Character materials

Studio → Character materials lists existing characters and planned candidates. Review the source image and optional 2–5 second voice sample before approving their stable HTTPS URLs. Use material whose rights permit the intended use. Each reference edit has an audit trail. A model-generated URL is never accepted as an approved reference automatically.

Ingestion and validation of these reference files into owned storage is still a launch task. Avoid transient signed URLs that will expire before generation or recovery.

## Stopped or uncertain tasks

- `NeedsReview`: the author can review and rejoin at a new queue position, or withdraw.
- `NeedsModeration`: inspect the stored original; do not regenerate merely because a playback derivative fails.
- `ReconciliationNeeded`: verify the provider request and charge. If a request ID is recorded, use **Resume known request** to poll/archive that request. Do not issue another paid POST. If the attempt outcome is unknown, investigate with the provider first.
- **Fail after verification** requires the actual reconciled upstream cost before releasing reserved funds. Never enter zero just to free the queue.

For a lost response, open the task’s recovery dialog, enter the existing fal request UUID and explain the provider checks. **Verify existing request** performs GET-only history/status checks and compares the model, submission time and every saved input field. **Link this verified request** verifies again before atomically attaching it; the task remains on hold. Then **Resume the existing request** records a unique recovery Workflow ID in D1. Competing operators cannot schedule a second recovery. If dispatch is temporarily unavailable, StoryRoom and scheduled reconciliation use that same saved workflow ID and resume flag.

The old Workflow must report a terminal state before linking, recovery or failure closure. A provider ID can belong to only one task and cannot be replaced; the attempt marker and saved submission evidence cannot be cleared. No recovery step sends a new paid POST. Input/model/time mismatches, unavailable provider history, or legacy attempts without an input snapshot stay on hold for provider reconciliation. Old-day tasks retain their original budget periods.

## Reports and account requests

Story reports appear in Studio → Reports. Hiding a scene leaves an explicit timeline placeholder and pauses that story for editorial review. Hidden media cannot be fetched through its normal scene endpoint, and hidden prompt text is redacted from story responses.

Account deletion requests appear in Studio → Account requests with private contact details. A request can be withdrawn by its owner. The UI does not claim an account is deleted when a request is submitted.

Open **Review deletion** to inspect the exact account, current policy, published contribution count and blockers. Send a private response from that dialog when tasks, billing or reports need attention. Execution requires a distinct administrator, a content-retention review and typing `DELETE ACCOUNT`. Hosted execution remains blocked while policies are drafts.

D1 rechecks active tasks (including other contributors in the person’s owned stories), previews, uncertain attempts, pending/held orders, purchased balances and open support cases within the deletion transaction. Successful execution revokes sign-in, removes private profile/activity and task inputs, pauses owned stories, anonymizes public bylines, redacts published original prompts and writes a single receipt/audit record. In-flight activity cannot recreate a deleted account’s drafts, orders or session. Terminal provider request IDs and minimal accounting/policy records remain; saved provider input can be erased only for a deleted account without altering those IDs.

Unpublished original video/caption keys enter a durable R2 cleanup queue. Scheduled reconciliation removes only exact task objects that are not referenced by published scenes; failures remain pending for retry. Shared scenes, story/cast/archive text and approved reference materials require a separate content/privacy review before execution. This is not automatic removal of every identifying detail from a story, provider retention or backup propagation. Final retention periods, provider requests and backup restoration handling still require approval and verification. See [account deletion](ACCOUNT-DELETION.md).

## Recovery, backups and rollout

Periodic Workers recovery wakes durable queues and unsent outbox events. Observability records request IDs, safe error codes and task audit actions rather than secrets or full user prompts.

Before production, configure and test D1 recovery plus durable R2 media backup/version retention. A code rollback does not undo a database migration or restore deleted media. Keep migrations compatible with the prior release or schedule a reviewed data migration. Provider/media failures must never reset a task to a blind paid retry.

## Studio diagnostics

Studio → Operations shows the latest result and last successful time for each scheduled check: payments, private media cleanup, speech results, provider balance, story queues, archives, story updates and expired sessions. Apply migration `0021_operation_results.sql` before deploying this version. It adds diagnostic columns only and remains compatible with the prior Worker.

Each component runs independently. A provider outage or a failed story queue does not prevent later cleanup, other queues or update delivery. Failed outbox items remain unsent for the next pass; already delivered items are not repeated. Partial failures mark the overall pass incomplete and preserve its last successful timestamp. A remote successful pass older than 15 minutes is flagged. Disabled integrations are shown as **Not enabled**, rather than counted as an external service check. A successful pass describes these scheduled operations, not end-to-end health of every provider feature.

Run IDs prevent an older overlapping pass from replacing a newer result, even if both started within the same millisecond. Component writes also belong to their parent pass; a superseded pass does not start further components. Held attempts, missing request IDs, retained cost reservations and Turnstile readiness remain visible. The cron retries existing active tasks even if new submissions to their story are paused.

Use `recovery.dispatch-deferred`, `reconciliation.failed` (with the failing operation name), `queue.recovery-failed`, `outbox.delivery-failed` and `request.error` events in Cloudflare logs. Before launch, route actionable failures to the operator’s chosen alert destination and rehearse outage, recovery and backup restoration. No outbound alert destination has been configured or messaged.
