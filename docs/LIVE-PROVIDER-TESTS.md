# Live provider experiment

2026-09-06. These are isolated opt-in tests using original fictional content and an original visual interpretation of literary Sherlock Holmes. The website remains in visibly labeled fixture mode; no live test footage was inserted into public story canon and no Cloudflare deployment occurred.

## Text editor

Four real DeepSeek `deepseek-v4-flash` requests exercised the application editor with an isolated in-memory database: a Chinese proposal, an existing-character proposal, a new-character candidate and a source-backed story archive. All four returned usable structured English output with valid character/source scope. Total reported usage: 3,098 input tokens and 1,476 output tokens; observed request times about 2.1–3.2 seconds. This small sample is not a latency SLA or precise cost invoice. See `live-editor-results.json`.

Manual review found continuity weaknesses worth retaining: a bridge invented supporting notebook/key knowledge; another proposed too many actions for ten seconds and restarted rain despite existing weather. The director instructions now forbid invented past knowledge, preserve ongoing weather and limit action beats. Those revised instructions and the new cast-selection field have not yet received another paid regression run. Do not report perfect story continuity.

## Video and speech

Model: `minimax/h3-max/reference-to-video`, 10 requested seconds, 768P, 16:9, safety enabled, balanced expansion. Both outputs contain H.264 video and AAC audio; measured MP4 duration is 10,144 ms each, with 1344×768 video frames.

| Test | Reference inputs | Actual spoken line | Observation |
| --- | --- | --- | --- |
| Clip 1 | One approved fictional Mara portrait | This key belongs here. | Short dark hair, orange raincoat, right-hand brass key and closed brass door visible. |
| Clip 2 | Same portrait plus the entire first clip | Someone is inside. | Character/clothes/key/door broadly persist; framing and gaze change at the join, so seamless continuity is not established. |

English was independently detected with fal’s ElevenLabs Scribe v2 ASR, without forcing the language. Language confidence was 0.911 and 0.914. The second transcription also detected rain and knocking. Transcription is not a voice-identity, lip-sync or OCR test. Frames were inspected at several points; full multi-character, long-run and frame-by-frame motion acceptance remains open.

The portrait was created with the development image-generation tool and stored as `public/art/characters/mara-vale-v1.png`. This is not evidence that an image-generation API is connected to the website.

The explicitly authorized fal experiment has a US$5 cumulative ceiling. Reserved allowances were US$1 + US$3 for the videos and US$0.10 for each of two speech checks: **US$4.20 reserved**. At the verified rates and reference sizes, video estimates were approximately US$0.80 and US$2.27. The user subsequently provided billing totals of **US$3.00 for reference video and US$0.02 for speech, US$3.02 total**. The original reservations remain in the journal, with this user-confirmed reconciliation recorded separately. The generation key still cannot read account billing (HTTP 403); automated reconciliation is not yet working. No automatic recharge or further paid retries occurred.

Ignored local files under `artifacts/fal-smoke/` retain both MP4s, frame extracts, request journal and speech results. The test helpers use a shared exclusive lock and record an attempt before paid submission. A known request can be polled without resubmission; an uncertain attempt must be reconciled. Preserve the journal and do not clear it to repeat a test inside the same authorization.

## Running an authorized experiment

Credentials are supplied through environment variables. The optional macOS Keychain helper reads the previously provisioned service item and injects it only into the child process. It does not write a secret file. Never print or commit keys.

The helpers refuse to run without explicit authorization flags; those flags do not grant spending authority. Obtain an applicable budget before use. Do not rerun the already completed two-clip experiment under a fresh empty ledger. New model, image or video tests need their own reviewed scope and allowance.

Official references: [H3 API](https://fal.ai/models/minimax/h3-max/reference-to-video/api), [H3 pricing](https://fal.ai/models/minimax/h3-max/reference-to-video), [Scribe v2](https://fal.ai/models/fal-ai/elevenlabs/speech-to-text/scribe-v2).

## Pure text-to-video comparison

Two additional real `minimax/h3-max-turbo/text-to-video` clips completed on 2026-09-06. Both request 10 seconds at 768P, 16:9, balanced expansion and safety enabled. No image, voice, video or fixed seed was passed. Identical descriptive anchors specify an original illustrated literary Sherlock Holmes, clothing, colors, room and props. The second prompt continues the written situation from the first. Each stored MP4 measures 10,144 ms.

Frame review found broadly similar black hair, suit, waistcoat, cravat, letter and green lamp, but different facial proportions, desk/window layout and screen direction. This supports recognizable traits, not stable facial identity or a seamless join. The requested English lines were not independently transcribed for these two clips; do not reuse the earlier reference test’s speech validation for them.

Each text clip reserved US$0.50 against a regular-rate US$0.40 estimate. Combined commitment is **US$3.02 user-confirmed prior charges + US$1.00 reserved = US$4.02**, within the original US$5 experiment allowance. The two new invoices have not been confirmed. Provider inference timing (~4.66 and ~4.70 seconds) is not end-to-end latency; manual polling did not measure that. The temporary price promotion was not used as the budget ceiling.

The local `low-cost.json` journal and `text-clip-1.mp4` / `text-clip-2.mp4` remain under ignored `artifacts/fal-smoke/`. **Per the latest owner instruction, no further image/reference video tests may run until the owner funds and reauthorizes them.** Current testing stays on the text route.

Model references: [Turbo text-only API](https://fal.ai/models/minimax/h3-max-turbo/text-to-video/api), [current pricing](https://fal.ai/models/minimax/h3-max-turbo/text-to-video).

## Additional authorization — 2026-09-07

The owner approved another US$5 for text-to-video and speech checks, bringing the cumulative experiment ceiling to US$10. The US$4.02 prior commitment remains counted, leaving at most US$5.98 for additional reserved tests. Paid image/reference generation remains paused. No new paid call is implied by this authorization record; record each attempt before submission and reconcile shared script/staging usage before further calls.

## Worker speech integration — 2026-09-07

Both saved Turbo text-to-video originals were sent through the actual Worker speech submission/polling/assessment implementation, with isolated durable SQLite/R2 adapters. No new video was generated and no public story was populated. MP4 data was streamed directly as base64 JSON; language was not forced and no premium keyterms were supplied.

| Existing text clip | Detected speech | Language confidence | Review result |
| --- | --- | --- | --- |
| 1 | This letter arrived too late. | 0.724 | Low confidence; correctly held for human listening |
| 2 | We have a visitor | 0.901 | English likely; manual publication review still required |

Both queue requests completed and produced timestamped WebVTT drafts. This verifies real fal MP4 transcription and the shared implementation, not deployed Workflow execution, full visual/lip-sync acceptance or OCR. Each check retains a US$0.10 conservative cost allowance: cumulative commitment is now **US$4.22**, leaving at most **US$5.78** under the US$10 authorization. Final invoices for the text video/speech checks remain unreconciled. Journals preserve immutable request IDs; another invocation polls the same request or returns the saved result and cannot charge again.
