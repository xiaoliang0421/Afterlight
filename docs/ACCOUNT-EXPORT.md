# Account-record downloads

Account → **A copy of your account** downloads a JSON file containing the current user's profile, Google profile and sign-in session metadata, owned story text, submitted ideas, authored scene text, free/purchased credits, orders, billing help, saved stories, watch progress, notifications, reports, privacy requests and agreement records. Accepted policies contain the immutable document accepted at that time.

This is a self-service account-record export, not a backup of all story media or a promise to fulfill every privacy access request automatically. Videos/reference files, other contributors' private drafts, authentication tokens, raw internal security logs and data held by separate providers are excluded. Additional access requests use the published support contact. Retention and account-deletion execution remain separate release work; the policies remain draft.

## Transport and boundaries

- `POST /api/account/export` authenticates the user, limits starts to six per hour, records an export-start audit event and captures per-section row boundaries/counts in a D1 batch.
- `POST /api/account/export/page` validates an allowlisted section, integer cursors and the current account ID. Every SQL query applies the authenticated owner predicate with bound values and an explicit field projection. An account ID supplied by the caller never selects another user's data.
- Each page contains at most 100 records. The server reads one extra row to determine whether another page is needed. Page requests are limited to 240 per minute per account.
- Both endpoints inherit same-origin JSON POST checks and `private, no-store` responses. No export is stored in public R2 or exposed through a reusable download URL.
- The browser fetches pages sequentially, displays progress, supports cancellation and assembles a file only after every request succeeds. Account changes/unmounting abort the download. A failure never offers a partial JSON file as complete.
- Assembly is limited to 16 MiB of encoded JSON; larger exports explicitly direct users to support. This bounds browser memory. The manifest states that updates/removals during reading may be reflected: pagination boundaries are not an immutable database snapshot.

## Verification

Isolated Workers integration tests exercise all sections, 205+ notifications across multiple pages, unauthorized/foreign-origin access, changed-account/unknown-section/invalid-cursor input, exact accepted policy inclusion, and two users with deliberately fake credential sentinels. The private sentinels never appear in the owner's file. Client tests cover valid JSON escaping, page completeness, account switches, stuck cursors, later-page failures, cancellation and the byte ceiling.

The browser-rendered interface and browser download gesture still require acceptance: automatic browser approval denied access to the local origin during this iteration. The account feature is not a claim of completed Google OAuth acceptance.
