# Product status

Updated 2026-09-08. The current release is **invitation-only, with no payments**, intended for a worldwide audience with an English interface. See [the launch runbook](NO-PAYMENT-LAUNCH.md) for the offered experience, review procedures and remaining production decisions.

## Implemented

- Public playback of approved stories, chapters, share pages, contributor attribution and viewing progress.
- Google sign-in, nickname onboarding, exact versioned terms acceptance, account export/deletion requests and Studio administration.
- Separate invited-participant and invited-host permissions. Hosts select private audience proposals and upload finished MP4 scenes. Upload retry and processing do not consume generation points.
- Mandatory Studio review for public story introductions, public nicknames and scene publication. Original submissions and adopted idea credits are included in scene review. Owners cannot bypass a review hold.
- Story blocking removes public story/media/caption/archive and contributor access; scene hiding stops further publication until Studio releases the hold. Contribution suspension does not remove account-request access.
- Queue, budget, provider-request recovery, media ingestion, character and canon versioning, operational diagnostics and manual reporting/review tools.

## Current release boundaries

Checkout, subscriptions, new platform generation and automatic AI archive dispatch are disabled. The existing payment adapter, prepaid generation and reference-production code are retained for later acceptance; they are not launch requirements for the upload-only edition. Historical controlled-test task contracts and settlement records are preserved.

Content moderation is manual. File/codec validation and AI speech checks are not a general content-review service. The invited pilot needs a responsible reviewer and an operational support/report channel.

`app.tailrelay.com` currently serves the isolated staging environment. Hosted Google sign-in and a real reviewed video publication were verified in earlier controlled testing. Local fixture tests and CI do not prove production OAuth, full hosted upload fulfillment or disaster recovery.

## Still required before production

- Confirm the public operator identity, age eligibility, support process, regional provisions for worldwide service and final retention/deletion terms. Policies remain a versioned draft until those decisions are complete.
- Configure the separate production origin, Google callback, Turnstile and environment-specific secrets. Preserve staging/production database and media isolation.
- Complete the applicable dated hosted acceptance record, including the no-payment host-upload/review flow, privacy requests, access gates, playback and report/takedown. Production preflight must pass without invented evidence.
- Select and test an alert destination before claiming unattended incident notification. Independent backups are currently deferred by the operator and are not provisioned by this release.

Longer real multi-scene continuity and paid-generation/payment acceptance remain later work. See [verification](VERIFICATION.md), [deployment](DEPLOYMENT.md) and [operations](OPERATIONS.md) for implementation history; dated historical gaps must be rechecked against the current release scope.
