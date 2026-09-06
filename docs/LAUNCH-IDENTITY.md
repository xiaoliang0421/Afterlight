# TaleRelay launch identity

Updated 2026-09-06.

## Brand

TaleRelay means a storytelling relay: contributors take turns shaping the next scene. The public tagline is **The next scene is yours.** UI, sign-in app name, sharing metadata and the current policy draft use this identity. The GitHub repository, Cloudflare resources, cookies and stored identifiers retain the internal Afterlight namespace.

An exact-name web search on 2026-09-06 returned no indexed product matches. This is an initial collision check, not trademark clearance. Cloudflare Registrar's authoritative domain check returned `talerelay.com` as registrable at standard pricing: USD 10.46 for registration and USD 10.46 for annual renewal at the time of the check. The subsequent owner checkout has not yet been confirmed as a completed registration. The bank displays an authorization hold; the owner reports that Cloudflare support estimates about 30 minutes for registry provisioning. At the earlier API check, neither a zone nor a registration workflow was found in the connected account. Recheck registration status before binding the domain; do not repeat checkout while payment/registration is unresolved.

The owner supplied `talerelay@proton.me` as the public support mailbox on 2026-09-06. Customer-facing support uses the display name **TaleRelay Support**. The app exposes a mailto link; no inbox automation, SMTP integration or test email has been configured or sent.

## Operator and merchant

Customer-service correspondence may use the brand display name. Paddle’s domain-review guidance expressly permits a sole proprietor’s brand in Terms & Conditions, while preferring the legal name. This corrects the earlier blanket instruction that the website must always publish the owner’s full legal name. It does not establish that a support alias meets every applicable privacy or consumer-law identity-disclosure requirement.

The operator field remains pending while the applicable identity-disclosure wording is settled. Do not invent a person/company, infer legal identity from repository usernames or treat TaleRelay Support as a legal entity. Keep policy status as draft until identity disclosure, retention/deletion and the outstanding launch terms are completed. Adding the confirmed mailbox and support contact advances the draft from `2026-09-06-draft4` to `2026-09-06-draft5`; previously accepted versions remain stored unchanged in D1.

Paddle documents an individual onboarding route: individuals and sole traders do not need the company business-verification step, but the individual must complete identity verification. Its supplier exclusion list does not currently list mainland China. Eligibility and payouts still depend on Paddle's review of the actual identity, location, product and account. Enter truthful information in Paddle's own onboarding screens; government IDs and payout details should not be sent to the application repository or support chat.

- [Paddle account verification](https://www.paddle.com/help/start/account-verification/what-is-account-verification)
- [Paddle identity verification](https://www.paddle.com/help/start/account-verification/what-is-identity-verification)
- [Paddle supported supplier countries](https://www.paddle.com/help/legal/sanctions/which-countries-are-supported-by-paddle)
- [Paddle domain review](https://www.paddle.com/help/start/account-verification/what-is-domain-verification)

## Next configuration steps

1. Public support contact is configured. Complete operator identity disclosure for the intended launch markets; do not request or publish personal identity documents in the project.
2. Configure a dedicated Google OAuth web client with TaleRelay branding. Domain registration does not block local development: the exact local callback is `http://127.0.0.1:5178/api/auth/callback/google`. For hosted acceptance, use the exact staging callback `https://afterlight-staging.liushenliang1994.workers.dev/api/auth/callback/google`. Avoid changing the existing ToolMoss client's consent branding. Store credentials only in the staging Worker's secret store, then test the actual Google redirect, callback, nickname onboarding and logout.
3. Add the owned production domain and its separate Google callback when available. Complete policy and free-creation acceptance before enabling the public service.
4. Owner completes Paddle merchant identity and payout onboarding. Configure sandbox catalog and verified webhooks and complete payment/refund/fulfillment acceptance before enabling real sales.

Cloudflare hosts the application; Paddle handles checkout and acts as merchant of record. Cloudflare agent setup does not register a Paddle merchant or activate payments.
