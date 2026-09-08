# Interface languages

TaleRelay defaults to English. The footer's **Preferences → Interface language** dialog offers English and Simplified Chinese. It is available without signing in, including on policy pages. The preference is stored only in `talerelay.ui-language` in browser local storage. Clearing storage resets it to English; storage failures retain the choice for the current tab. Other open tabs follow storage changes.

The shared external store updates the current React tree without navigation, locale keys or remounting. Form values, filters, selected scenes and playback belong to their existing components. Interface language does not change account permissions, policy acceptance, network submissions or creation settings.

## Copy ownership

- Translate application-owned text with `t()` at rendering time. `src/locales/zh-CN.json` maps complete English source messages to Chinese. Use `{0}`, `{1}` parameters for values, with matching parameters in both languages. React escapes rendered values normally.
- Keep action IDs, enum values, routes, request payloads and persisted state canonical. Translate their visible labels, never their values or React keys. Store asynchronous status/error copy in English and translate it when displayed.
- Preserve story titles, loglines, prompts, character names/descriptions, public nicknames, review explanations, video dialogue and captions as submitted. Generated and published story language remains English. Never translate a rendered DOM tree or arbitrary user content.
- Known server errors have readable Chinese equivalents. Unknown provider diagnostics retain their original details; do not silently misrepresent them as successful operations. The human-verification dialog requests the current widget language.

## Policy reading translations

`shared/policies.json` remains the canonical policy and immutable acceptance source. `src/locales/policies.zh-CN.json` contains a complete Chinese reading copy with the same section IDs, paragraph counts and version, plus a SHA-256 of the canonical JSON serialization. Chinese readers can switch to the English original within the policy page. The source's draft status, operator identification and effective date stay visible.

The translation does not finalize the policies, accept them for an account or replace downloaded historical acceptance records. When the canonical policy changes, review and update its Chinese reading copy and digest together; the test suite fails on a stale translation.

## Verification

`npm run check` covers literal catalog keys, operational labels, parameter parity, missing-key fallback, unavailable local storage and policy-source synchronization. `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e:integration` adds desktop and emulated-phone checks for the discreet anonymous switch, persistence, form and filter preservation, untranslated authored content, readable network failures and policy-original access, alongside the existing English upload/review tests. The playback test serves the existing local synthetic MP4 explicitly because the fixture database does not seed sample video bytes in R2. These checks do not represent physical-device or paid-model acceptance.
