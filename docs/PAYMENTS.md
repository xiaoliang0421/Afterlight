# Paddle payments and generation modes

Updated 2026-09-07. **The integration code is implemented; real checkout and paid reference generation are closed.** Live and Sandbox accounts are accessible in the browser, but there is no authenticated Paddle API connection, real sandbox acceptance or merchant activation yet. No product prices have been chosen or created.

## Product behavior

| Mode             | Balance                   | Inputs                                                               | Current availability                                               |
| ---------------- | ------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Text to video    | Prepaid creation points   | Prompt, fixed character descriptions, current state and story bridge | Default production option; local balances and prices are synthetic |
| Reference guided | Purchased creation points | Approved images, optional approved voice, eligible previous scene    | Adapter retained; disabled pending setup and acceptance            |

The two modes use the same story-scoped FIFO and publication review. Paid scenes never jump the queue. References may improve visual continuity but cannot guarantee a face or seamless transition. Turbo single-first-frame image generation currently has the same base price as Turbo text generation; the paid path here is the retained **H3 Max multi-reference** adapter. Do not market all image-to-video as inherently more expensive.

Each task stores an immutable mode, exact provider model, quoted point amount and provider reserve and billing contract. Previously free tasks stay free. Paid points are reserved atomically on queue admission and consumed on approved publication. Withdrawal before start, failed delivery or rejection returns the reservation. An uncertain upstream request remains reserved until reconciliation. Provider costs and customer point consumption remain separate.

## Implemented payment flow

1. An authenticated storyteller explicitly acknowledges the current purchase terms and chooses a server-side package.
2. The Worker creates an immutable pending order and creates one automatic Paddle transaction with the server’s price, currency and order ID. An uncertain POST is not repeated. One unfinished checkout per account prevents accidental parallel orders.
3. The lazily loaded official `@paddle/paddle-js` SDK opens checkout for that transaction. Abandoned pending checkouts can resume from Account. The browser callback never grants points.
4. `/api/billing/webhook` checks Paddle’s HMAC against the untouched body with a five-second timestamp tolerance, saves unique event routing metadata in D1 and acknowledges quickly. It does not store full billing addresses or card data.
5. Background processing reads the current transaction and adjustments from Paddle. It verifies the saved order, transaction, one-time price, quantity, amount, currency, tax and zero-discount/credit contract before granting points. Duplicate and out-of-order events converge on the current state.
6. D1 atomically changes the order’s granted point total and its wallet/ledger delta. Approved partial refunds revoke a proportional rounded-up number of points; full refunds revoke the grant. Refunds after spending can create a negative balance and block paid admission. Pending adjustments and disputes hold the paid balance for review.
7. Signed events, manual account status checks and scheduled reconciliation keep working when new purchases are switched off. Known orders can be reconciled by an authenticated administrator at `/api/billing/admin/reconcile`; this only attaches a verified existing Paddle transaction.

Endpoints: authenticated `GET /api/billing`, `POST /api/billing/checkout`, `POST /api/billing/orders/:id/checkout`, `POST /api/billing/orders/:id/sync`. Other users cannot inspect or resume an order.

Payment refunds are distinct from returning generation points. Users can submit private Payment help requests beside an order; Studio → Payments lists requests, records a customer-visible response and reconciles existing transactions. Resolving a support request does not issue a refund. The studio handles refunds through Paddle’s dashboard; this version does not automatically issue money refunds or support subscriptions, creator payouts or automatic top-ups. Chargeback/credit reversals remain held for human reconciliation. A technical timeout does not prove a purchase was canceled.

Host uploads use no generation points and do not invoke fal. Audience proposals are free; their authors are not charged when a host selects them. See [the production contract](PRODUCT-DIRECTION.md).

## Configuration and owner setup

The official `paddle@paddle-agent-skills` v0.1.0 plugin was installed from PaddleHQ/paddle-agent-skills (source commit `de7fcd3f6cc43bf87a65d6b2e65067611b47353c`). Installation supplies development guidance and potential MCP connections; it does not create a merchant or connect its credentials. The checkout, webhook, catalog and sandbox skills were read. Their Next.js examples are adapted to React/Vite and Hono/Workers using Paddle’s REST API and Web Crypto.

The owner authorized use of the existing live dashboard on 2026-09-06. Its onboarding page explicitly displayed **You’re in Live** and all three tasks (live setup, account verification, test/go-live) as **Not started**. The existing merchant can be retained. The owner subsequently registered a separate Sandbox account; browser inspection confirmed **Test mode / You’re in Sandbox**, with all four integration tasks not started. The Authentication page had no API keys. Opening the new-key form succeeded, but filling it timed out; Save was never invoked. No key, catalog, webhook or activation change is confirmed.

The configuration check on 2026-09-06 found no callable Paddle MCP connection and no `PADDLE_*` secret names on the staging Worker. The installed skills provide instructions, not merchant access. Sandbox does not require domain approval, so its account/catalog setup can proceed while domain registration is pending. End-to-end webhooks still need a reachable HTTPS endpoint.

Sandbox registration is complete. The next dependency is an API credential, using the [secure local handoff](PADDLE-SANDBOX.md). After connection, the remaining setup can be operated with Paddle tools/API within the owner’s authorization:

- Agree on the one-time point packages, USD base price, points per scene and refund/delivery terms. Create one-time catalog prices with no recurring cycle, no regional overrides/discounts and tax-exclusive USD amounts for this initial adapter. Insert matching package records in D1 only after verifying the catalog.
- Supply server secrets `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, and the public `PADDLE_CLIENT_TOKEN` via the hosting secret/config mechanism. Never put keys in source, config files or Git. Sandbox and live use separate credentials, prices and databases.
- Set `PADDLE_ENVIRONMENT=sandbox` for local/staging testing. Set the default payment link and a reachable approved checkout origin in Paddle; register the webhook endpoint for transaction and adjustment events.
- For text production, configure D1 `text_points` and an adequate `task_reserve_cents` after price and fulfillment acceptance. For reference production, only after reference materials, input cost ceilings and delivery are ready, configure D1 `reference_generation_enabled`, `reference_points`, `reference_reserve_cents` and `REFERENCE_GENERATION_ENABLED=true`. `PAYMENTS_ENABLED=true` additionally requires valid Paddle configuration. New purchases pause when current provider balance/capacity is unavailable.
- Test a successful and declined sandbox checkout, lost response, repeated callback, missing/replayed webhook, partial/full refund, dispute, order ownership, point consumption and failed-video return. Tests must use mock video fulfillment until image/reference spending is reauthorized.
- Live setup requires the owner’s verified legal identity/entity, eligible product, settlement/tax information, approved domain and provider agreement. It requires final policies, verified production catalog, acceptance evidence, `PADDLE_ENVIRONMENT=production` and explicit `PADDLE_LIVE_APPROVED=true`. Cloudflare hosts this code but does not create or verify a Paddle merchant.

There is deliberately no default commercial price, active package or fake checkout. The launch preflight checks payment evidence separately from watching, audience proposals and host uploads. Real sandbox checkout and live activation have **not** been verified.

## Official references

- [Paddle agent skills](https://github.com/PaddleHQ/paddle-agent-skills)
- [Create a transaction](https://developer.paddle.com/api-reference/transactions/create-transaction)
- [Verify webhook signatures](https://developer.paddle.com/webhooks/about/signature-verification)
- [Webhook delivery and retries](https://developer.paddle.com/webhooks/about/respond-to-webhooks)
- [Sandbox](https://developer.paddle.com/sdks/sandbox)
- [Go-live checklist](https://developer.paddle.com/build/go-live-checklist)
