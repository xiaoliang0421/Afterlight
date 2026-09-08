# No-payment early access

Updated 2026-09-08. This is the current release scope. Historical payment and AI-generation implementation documents describe later or controlled-test capabilities, not features offered in this release.

The intended service area is **worldwide**, confirmed by the owner on 2026-09-08. The first release remains English-language, invitation-only for creation and without payments.

## Offered experience

- Anyone can watch approved stories. Google sign-in creates an account with watching access; it does not grant creation or Studio access.
- Studio can invite a signed-in account as a participant (private proposals) or host (world creation, proposal selection and finished-video upload).
- New story introductions remain private until Studio reviews their title, description, world rules, style, cover and characters. The owner cannot open a pending or blocked story.
- Each uploaded scene stays private until Studio checks the complete video, audio, visible text, continuity, original submission and adopted idea credits. Uploads consume no generation points.
- Public nicknames require separate approval. A requested nickname change leaves the previously reviewed public name in place until approved; unapproved or removed names use “Storyteller”.
- Checkout, subscriptions and new platform generation are closed. Historical tasks and settlement records retain their original contracts. Disabling provider mode also prevents newly queued AI archive dispatch.

## Operating the invited pilot

1. Ask an invited adult to sign in and choose a nickname. In **Studio → Stories & community**, identify their exact account email, review the public nickname and grant the intended contribution access with a reason. Community access never grants administrator permissions.
2. Review each pending story using **Review story**. Approval opens that exact introduction. A changed introduction must be reviewed again.
3. The host selects ideas and uploads footage with its actual summary and events. Check rights to footage, music, voices and likenesses, then submit it for review.
4. In the scene review, inspect the full clip and sound, readable text, proposed canon and every original idea that will be publicly credited. All review confirmations are required before publication. Automated format validation is not content review.
5. Respond to reports in Studio. Hide an individual scene when appropriate; this also holds further publication. Block the whole story in **Stories & community** when its public introduction or overall content must be removed. Blocking stops public story, media, caption, archive and contributor-page access. A host cannot undo the hold. Reopen only after a new Studio review.
6. Suspend contribution access when needed. This stops new creative work and publication but leaves account requests available. Remove an unsafe nickname or block affected stories separately; suspension alone does not erase published content.

No automated content-moderation vendor is integrated. Named human reviewers must be available for the number of invited participants. Do not accept more submissions than that team can review. If an issue needs removal, act on the content as well as the account.

## Deployment checklist

- Apply migration `0023_launch_moderation.sql` before the dependent Worker. It defaults to invitation-only access; only existing Studio administrators retain host access. Existing publicly published stories/names are migrated as approved; private drafts remain pending. Local fixtures explicitly disable invitation gating for synthetic test personas.
- Explicitly deploy `PROVIDER_MODE=disabled`, `PAYMENTS_ENABLED=false` and `ALLOW_DEV_LOGIN=false`. Keep reference generation off and the text production price at zero (zero disables new text production; it is not a free price). Keep finished-video uploads enabled. Do not change the existing paid-task budget or erase its accounting.
- Verify public playback, authenticated host upload/retry, mandatory review, blocked-content access, invitation restrictions and report handling on the intended environment. Synthetic browser/API tests do not constitute hosted OAuth, real uploaded-footage review or a production incident drill.
- Finalize the operator identity, age eligibility, the regional provisions for the confirmed worldwide scope, support contact, retention/deletion rules and current terms/privacy version. Keep draft policies clearly labeled until this is complete. Existing acceptance is never rewritten to the new version.
- Configure the production origin, matching Google callback and Turnstile hostname/secret on the separate production Worker, D1 and R2. The current `app.tailrelay.com` binding is staging; a successful staging deployment is not a production cutover.
- Populate the applicable evidence in the local ignored `release.acceptance.json`, then run `npm run deploy:check -- production`. Upload-only launch still requires Google login, mobile playback, media recovery, privacy requests, abuse controls, host upload, invitation and content/public-metadata review, report/takedown and cloud smoke evidence. Paid-generation and checkout evidence is required only when those capabilities are enabled.

Independent backups are deferred by the operator. This release does not provision or schedule them and does not claim independently recoverable media. Existing platform storage and earlier drills are not a substitute for an independent backup. Choose an alert destination and verify delivery before relying on unattended incident response; local diagnostics alone are not an alert channel.

## Remaining production decisions

Worldwide audience is confirmed. The operator's public identity, age eligibility, final regional policy provisions and production origin remain to be established. Obtain these facts before representing the service as a finalized public launch. Keep the pilot small while actual hosted upload/review and operational acceptance are completed. No payment-account onboarding is needed for this release.
