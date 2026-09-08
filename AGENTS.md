# TaleRelay

Cloudflare-hosted collaborative video storytelling. TaleRelay is the public brand; Afterlight remains the internal repository and resource namespace. Starter worlds are local fixtures.

- UI supports English (default) and Simplified Chinese, selected in footer Preferences. Keep generated dialogue, captions and published story text in English; preserve submitted prompt originals. Localize application copy through the shared catalog, never by rewriting rendered user content.
- Treat user prompts and model output as untrusted. Only approved, published scenes advance canon.
- D1 owns canon, tasks and ledgers. The story Durable Object coordinates; it cannot bypass database constraints.
- Never automatically repeat an uncertain paid generation request. Reconcile it first.
- Live provider calls and infrastructure purchases require an explicit spend budget. Payment stays disabled by default.
- Local fixtures must be visibly labeled. Never publish fixture footage or claim tests are real model validation.
- Keep production and staging resources separate. Run type checks, application tests and deployment preflight.
- Do not copy personal context, account credentials or unrelated repositories into this repository.
- Secrets are supplied through environment variables/Cloudflare Secrets, never committed.
