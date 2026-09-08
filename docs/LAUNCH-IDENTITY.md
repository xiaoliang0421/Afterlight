# TaleRelay launch identity

Updated 2026-09-08.

The public brand is **TaleRelay**. The purchased domain is **tailrelay.com** (tail, not tale), and `https://app.tailrelay.com` currently serves the isolated staging application. GitHub, Cloudflare resources, cookies and internal identifiers retain the Afterlight namespace.

The configured support mailbox is `talerelay@proton.me`, displayed as TaleRelay Support. This display name is not an established legal entity. A mailto link does not prove inbox monitoring or response-time coverage.

The owner confirmed worldwide service scope on 2026-09-08. The first edition keeps its English interface, invited creation and no-payment scope. Worldwide is the intended audience; local network/provider availability and applicable regional requirements still need validation.

The operator's public identity, age eligibility, retention rules and final terms/privacy provisions still need confirmation. Do not infer legal identity from repository usernames or publish identity documents. Policies remain draft `2026-09-08-draft7`; earlier accepted document versions remain unchanged in D1.

Staging uses the dedicated TaleRelay Google client and callback `https://app.tailrelay.com/api/auth/callback/google`. Production needs its own confirmed origin, exact callback and Turnstile hostname configuration. Do not replace unrelated product branding or bind a second environment to the current staging domain without a reviewed cutover.

The initial release offers no payments or subscriptions. Merchant identity, payout setup, checkout catalogs and commercial prices are deferred. These are not requirements to exercise the [invited upload-and-review pilot](NO-PAYMENT-LAUNCH.md).

## Operator-name clarification

The owner requested the same public operator name as staging. The actual staging privacy page currently shows **Operator: To be confirmed before launch**; `shared/policies.json` has an empty `operatorName`. TaleRelay is the brand, TaleRelay Support is the contact display name and Liang is a reviewed author nickname. Confirm the intended public operator name before assigning any one of these values. Do not infer a responsible legal person or company from a brand, nickname or account profile.

Worldwide service planning must account for applicable privacy obligations even when checkout is disabled. GDPR Article 3 includes certain offers of services to people in the EU regardless of payment; Article 13 requires the controller identity and contact details where applicable. This identifies a review requirement, not a conclusion that the current draft satisfies it. [Official GDPR text](https://eur-lex.europa.eu/eli/reg/2016/679/art_3/oj).
