# Product completion checklist

Updated 2026-09-06. This is the implementation backlog, not permission to enable payments, spend on providers or deploy cloud resources. The site runs locally with clearly labeled fixtures. Real provider experiments were isolated from the website.

## Working locally

- Independent worlds, stable character IDs, creator attribution, prompt provenance, sharing, per-story watch progress and chapter replay.
- Contributor previews, a FIFO queue with current-canon checks, budget reservations, Workflow recovery for known requests, stored media and human publication review.
- Character/story archive proposals with reviewed, versioned publication and spoiler-aware reading.
- Limited free text generation and retained paid reference generation; separate free credits and purchased points.
- Paddle checkout adapter, verified event inbox, idempotent point grants, reconciliation, refund accounting and order help. Real checkout is disabled and no merchant catalog is connected.
- Draft legal pages, exact acceptance records and account-deletion requests. Policies are not final; deletion execution is not implemented.
- **Added this iteration:** major-change owner decisions. Contributors explicitly share a private proposal; the story creator reviews the original, English adaptation, current world/cast context and proposed events. Approval applies only to that plan and canon version. Waiting does not reserve a video credit or occupy the FIFO queue. The contributor confirms admission after approval, and generation checks the approval again. Ordinary new-character entrances can continue normally. Model classification still needs live evaluation.

## Development that can proceed without new accounts

| Priority | Unfinished capability | Completion evidence |
| --- | --- | --- |
| Next | Recover a lost fal submission response in Studio | Attach a verified existing request to the original attempt; reject wrong model/task links; resume polling/archiving without a new paid POST; preserve cost reservations. Currently a lost request ID needs manual database repair. |
| High | Account data export and deletion execution | Authenticated scoped export, review of unfinished tasks/orders, user-visible outcomes, appropriate attribution anonymization, session removal and an audit trail. Final retention/operator policy must be settled before destructive execution is enabled. |
| High | Abuse controls and operational diagnostics | Turnstile verification at creation endpoints, failure/rate-limit UX, alerts and a rehearsed incident runbook. Widget provisioning and real verification require Cloudflare configuration. |
| High | English audio/text verification | Automated transcript language checks and caption proposals, suspicious-text review, failures routed to human review. Real ASR/OCR tests need an authorized provider budget. |
| High | Complete episode playback | Prebuffering, seek/author mapping, interrupted download/recovery, mobile testing and a selected Stream or packaging path. The current MP4 sequence does not promise gapless playback. Cloud processing needs configuration and a cost decision. |
| Before paid reference launch | Owned character/reference media and a defensible cost ceiling | Verify media type, dimensions, duration, provenance and storage; quote all charged inputs. Existing reference-generation code remains intact; paid reference tests stay paused. |

## Account/configuration and real acceptance work

1. Confirm the public name/domain, operator identity and support mailbox. Finalize and version the policies.
2. Configure Google OAuth on the real callback origin; test first sign-in, nickname setup and account recovery.
3. Configure Paddle sandbox, approved product/price IDs and callback secrets. Test checkout success/decline, duplicate/out-of-order webhooks, recovery, partial/full refunds, disputes and fulfillment. Choose point packages and commercial prices before enabling sales.
4. Provision separate Cloudflare staging/production resources, configure secrets, validate GitHub CI and perform domain smoke tests plus backup/restore drills.
5. Run the complete text-to-video website flow and a longer story test: returning/new characters, English, visible causal transitions, review, archiving and playback. Reconcile actual invoices and capacity cutoffs.

The free path may launch before purchases once its own release gates pass. Do not call the whole product production-ready until the applicable evidence in `release.acceptance.example.json` is present. See [verification](VERIFICATION.md), [deployment](DEPLOYMENT.md) and [operations](OPERATIONS.md).
