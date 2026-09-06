# TaleRelay launch identity

Updated 2026-09-06.

## Brand

TaleRelay means a storytelling relay: contributors take turns shaping the next scene. The public tagline is **The next scene is yours.** UI, sign-in app name, sharing metadata and the current policy draft use this identity. The GitHub repository, Cloudflare resources, cookies and stored identifiers retain the internal Afterlight namespace.

An exact-name web search on 2026-09-06 returned no indexed product matches. This is an initial collision check, not trademark clearance. Cloudflare Registrar's authoritative domain check returned `talerelay.com` as registrable at standard pricing: USD 10.46 for registration and USD 10.46 for annual renewal at the time of the check. No domain was purchased or reserved. Recheck availability and the checkout total before an authorized purchase.

The support mailbox is pending. The intended domain mailbox is `support@talerelay.com` after domain ownership and mail routing are established; it must not be displayed as a working contact before then.

## Operator and merchant

For an individual operator, prepare the public attribution as:

> TaleRelay is operated by [full legal name], an independent developer operating under the TaleRelay brand.

The owner must supply the exact public legal-name spelling and a working support email. Do not infer legal identity from repository usernames or use a company suffix for an unregistered company. Keep policy status as draft until the identity, retention/deletion process and other outstanding launch terms are completed. The rename advances the draft from `2026-09-06-draft3` to `2026-09-06-draft4`; previously accepted versions remain stored unchanged in D1.

Paddle documents an individual onboarding route: individuals and sole traders do not need the company business-verification step, but the individual must complete identity verification. Its supplier exclusion list does not currently list mainland China. Eligibility and payouts still depend on Paddle's review of the actual identity, location, product and account. Enter truthful information in Paddle's own onboarding screens; government IDs and payout details should not be sent to the application repository or support chat.

- [Paddle account verification](https://www.paddle.com/help/start/account-verification/what-is-account-verification)
- [Paddle identity verification](https://www.paddle.com/help/start/account-verification/what-is-identity-verification)
- [Paddle supported supplier countries](https://www.paddle.com/help/legal/sanctions/which-countries-are-supported-by-paddle)
- [Paddle domain review](https://www.paddle.com/help/start/account-verification/what-is-domain-verification)

## Next configuration steps

1. Owner creates a support mailbox and confirms the public operator name.
2. Configure a dedicated Google OAuth web client with TaleRelay branding; use the exact staging callback `https://afterlight-staging.liushenliang1994.workers.dev/api/auth/callback/google`. Avoid changing the existing ToolMoss client's consent branding. Store credentials only in the staging Worker's secret store, then test the actual Google redirect, callback, nickname onboarding and logout.
3. Add the owned production domain and its separate Google callback when available. Complete policy and free-creation acceptance before enabling the public service.
4. Owner completes Paddle merchant identity and payout onboarding. Configure sandbox catalog and verified webhooks and complete payment/refund/fulfillment acceptance before enabling real sales.

Cloudflare hosts the application; Paddle handles checkout and acts as merchant of record. Cloudflare agent setup does not register a Paddle merchant or activate payments.
