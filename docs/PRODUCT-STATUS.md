# Product completion checklist

Updated 2026-09-06. This is the implementation backlog, not permission to enable payments, spend on providers or deploy cloud resources. TaleRelay runs locally with clearly labeled fixtures; the empty staging shell is now deployed with generation and payments disabled. Real provider experiments were isolated from the website.

## Working locally

- Independent worlds, stable character IDs, creator attribution, prompt provenance, sharing, per-story watch progress and chapter replay.
- Contributor previews, a FIFO queue with current-canon checks, budget reservations, verified fal request recovery, stored media and human publication review. Studio can preview and link a lost request ID after matching its model, submission time and saved input; recovery retains the attempt and resumes the existing request. Old attempts without input evidence stay on hold.
- Character/story archive proposals with reviewed, versioned publication and spoiler-aware reading.
- Limited free text generation and retained paid reference generation; separate free credits and purchased points.
- Paddle checkout adapter, verified event inbox, idempotent point grants, reconciliation, refund accounting and order help. Real checkout is disabled and no merchant catalog is connected.
- Draft legal pages, exact acceptance records and account-deletion requests. Policies are not final; deletion execution is not implemented.
- **Added this iteration:** major-change owner decisions. Contributors explicitly share a private proposal; the story creator reviews the original, English adaptation, current world/cast context and proposed events. Approval applies only to that plan and canon version. Waiting does not reserve a video credit or occupy the FIFO queue. The contributor confirms admission after approval, and generation checks the approval again. Ordinary new-character entrances can continue normally. Model classification still needs live evaluation.

## Development that can proceed without new accounts

| Priority | Unfinished capability | Completion evidence |
| --- | --- | --- |
| Staging acceptance | Exercise verified fal recovery on a deployed Workflow | Studio linking and durable recovery dispatch are implemented and locally tested. The existing key can read real request history and queue status. Validate cloud dispatch/crash recovery before launch. |
| High | Account data export and deletion execution | Authenticated scoped export, review of unfinished tasks/orders, user-visible outcomes, appropriate attribution anonymization, session removal and an audit trail. Final retention/operator policy must be settled before destructive execution is enabled. |
| Staging acceptance | Abuse controls and operational diagnostics | Creation/preview/admission now require exact-host/action Turnstile verification outside local fixtures. Account/IP throttles, safe failures, browser cross-site video restrictions and Studio cron/held-task diagnostics are implemented. A staging widget and matching Worker secret are provisioned. Rehearse the real challenge after Google sign-in and HTTP connectivity work, then configure a chosen alert destination. |
| High | English audio/text verification | Automated transcript language checks and caption proposals, suspicious-text review, failures routed to human review. Real ASR/OCR tests need an authorized provider budget. |
| High | Complete episode playback | Next-clip MP4 prebuffering, clamped seeking, original-position retries, HLS reinitialization, offline/loading UI and chapter replay are implemented. Three local fixture clips played through in the browser. Still validate retries under network throttling, mobile and long real chapters; select a Stream or packaging path if required. The MP4 sequence does not promise gapless playback. |
| Before paid reference launch | Owned character/reference media and a defensible cost ceiling | Verify media type, dimensions, duration, provenance and storage; quote all charged inputs. Existing reference-generation code remains intact; paid reference tests stay paused. |

## Account/configuration and real acceptance work

1. Public name is TaleRelay. Its .com was available at the last authoritative check but has not been purchased. Owner must supply the public legal-name spelling and support mailbox; finalize the remaining policy provisions.
2. Configure Google OAuth on the real callback origin; test first sign-in, nickname setup and account recovery.
3. Configure Paddle sandbox, approved product/price IDs and callback secrets. Test checkout success/decline, duplicate/out-of-order webhooks, recovery, partial/full refunds, disputes and fulfillment. Choose point packages and commercial prices before enabling sales.
4. R2 buckets and D1 databases are created separately for staging/production; R2 public access is disabled. All 17 remote migrations are applied, with no fixture data. Wrangler authentication, staging Worker/Workflows, session/Turnstile secrets and a successful remote cron run are complete. Public HTTP smoke tests remain blocked by the test network’s workers.dev DNS/connectivity failure; Google/provider/payment secrets, actual GitHub CI evidence and backup/restore drills remain.
5. Run the complete text-to-video website flow and a longer story test: returning/new characters, English, visible causal transitions, review, archiving and playback. Reconcile actual invoices and capacity cutoffs.

The free path may launch before purchases once its own release gates pass. Do not call the whole product production-ready until the applicable evidence in `release.acceptance.example.json` is present. See [verification](VERIFICATION.md), [deployment](DEPLOYMENT.md) and [operations](OPERATIONS.md).
