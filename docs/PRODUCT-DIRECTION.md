# Story production and audience proposals

The first release centers on a host developing a story with its audience. Viewers can watch and submit an idea without buying video generation. The host selects ideas before producing the next scene.

There are two production choices: platform generation using prepaid creation points, and uploading a finished video. Uploading is an optional production method, not the product's primary purpose. Both methods use the same story history, publication review, playback and contribution credits.

## Delivery contract

- New text and reference generation tasks quote purchased points before admission. The account explicitly starting generation pays; selecting an audience proposal does not debit its author. Existing free tasks retain their original settlement rules.
- Proposals are private to their author and the host until an adopted scene is published. Submission explicitly permits the proposal and nickname to be credited on an adopted scene. The author may withdraw an uncommitted proposal. Selection does not promise publication or trigger generation.
- Hosts may upload an MP4 of up to 60 seconds and 64 MiB, provide its actual story summary and events, and confirm permission to publish. Uploads do not spend generation points or call the video provider. The first version requires browser-compatible H.264 video, with AAC audio when present.
- A finished upload enters the same story queue. If earlier publication advances the story, the host must review its continuity against the new version. Uploads never overwrite established history or silently regenerate the video.
- A published scene identifies its producer and adopted proposal contributors separately. Human review checks actual footage, dialogue, captions, continuity and content before it advances the story.
- Commercial point packages and prices must be configured explicitly. Development balances are synthetic. Real checkout stays gated on payment acceptance and merchant setup; no new provider spending or account permissions are implied by this code change.

## Validation priorities

Check concurrent balance reservations, old free-task settlement, interrupted upload/retry, unauthorized uploads, proposal withdrawal/selection races, actual media validation, private media access, changed story versions and publication attribution. Then exercise a short serial with real users before expanding the catalog or adding subscriptions.

## Implemented acceptance — 2026-09-08

- TypeScript, production build and 95 application/database/runtime tests pass. The migration preserves old text writers during rollout; the new API explicitly writes the purchased-point contract. No commercial price is seeded.
- 21 native Worker integration runner tests pass, including concurrent adopted-idea submission, private R2 upload, invalid-file rejection followed by retry, source isolation, zero-point publication, public byte ranges and separate producer/proposal credit.
- Four browser checks pass on desktop and an emulated phone viewport, including interrupted upload followed by successful retry and decoded sample playback. This is local Chrome evidence, not physical iPhone Safari or Android device acceptance. Run `npm run test:e2e:integration`; an installed Chrome can be selected with `PLAYWRIGHT_CHANNEL=chrome`.
- Migration 0022 starts with uploads closed and text pricing unset. Enable `uploads_enabled` only after the corresponding environment's smoke checks. Configure `text_points` separately when commercial pricing is agreed. Keep `PAYMENTS_ENABLED=false` until real merchant, catalog, webhook and fulfillment acceptance is complete.
