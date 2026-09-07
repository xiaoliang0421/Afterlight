# Paddle Sandbox credential handoff

Updated 2026-09-07. Sandbox registration is verified. API access, catalog, client token, webhook delivery and actual checkout acceptance are still pending. Payment and reference generation switches remain off.

## Create the setup key

Use [Sandbox Authentication](https://sandbox-vendors.paddle.com/authentication-v2), API keys → New API key. Name it `TaleRelay Sandbox Integration`, retain the 90-day expiry, and select only these scopes for the planned setup and acceptance:

| Resource | Access | Purpose |
| --- | --- | --- |
| Products | Read, Write | Create and verify the agreed test product |
| Prices | Read, Write | Create and verify the agreed one-time test price |
| Transactions | Read, Write | Create checkout and reconcile fulfillment |
| Adjustments | Read | Reconcile refunds performed in the dashboard |
| Client-side tokens | Read, Write | Configure Paddle.js with a Sandbox token |
| Notification settings | Read, Write | Configure the signed webhook destination |
| Notifications | Read | Inspect delivery status |
| Notification simulations | Read, Write | Exercise test webhook scenarios |

Do not select All or live access. The setup key is not the final runtime key: the current Worker needs `transaction.read`, `transaction.write` and `adjustment.read`; provision a separate restricted runtime key before deployment. Refund issuance remains a dashboard action.

## Save without a secret file

The existing provider credential helper now supports `paddle-sandbox`. In a local interactive terminal at the project directory:

```sh
python3 scripts/deepseek-keychain.py --provider paddle-sandbox save
```

After clicking Save in Paddle, copy the newly shown Sandbox API key and paste it at the hidden prompt, then press Enter. The key is stored under macOS Keychain service `afterlight.paddle-sandbox`, account `api`. The helper refuses Paddle live keys, client-side tokens and visible-input fallback. Do not paste the key into chat or an `.env` file.

Verify only read access, without printing catalog data or creating a transaction:

```sh
python3 scripts/deepseek-keychain.py --provider paddle-sandbox check
```

Authenticated success means `product.read` works; it does not prove all write permissions, webhook delivery or checkout acceptance. `run <command> [args...]` supplies the key to a trusted child process through `PADDLE_API_KEY`, forcing `PADDLE_ENVIRONMENT=sandbox`. Never run a command that prints environment variables. The helper does not upload credentials to Cloudflare or enable payments.

## Remaining acceptance

The proposed test-only package is **100 creation points / USD 10 before tax / one-time**. Owner confirmation is pending; this is not a chosen commercial price and must not be created or enabled without that answer. After agreement and API access, use the Paddle catalog skill to create and verify IDs, configure a separate Sandbox client token and webhook secret, and map the verified package to the test database.

Use mock video fulfillment for successful and declined checkout, duplicate events, lost responses, refunds and point ledger tests. Do not turn on paid provider generation to make payment tests pass. The intended staging webhook is now reachable at `https://app.tailrelay.com/api/billing/webhook`. API credentials, a Sandbox notification destination/secret and full authenticated checkout acceptance are still pending. Local browser access is unnecessary for testing the deployed custom domain.

Credential helper regression tests (all storage and HTTP mocked):

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_keychain_helper.py'
```

Official references: [API authentication and permissions](https://developer.paddle.com/api-reference/about/authentication/), [Sandbox separation and test payments](https://developer.paddle.com/sdks/sandbox/).
