# Character identity in text-to-video stories

Updated 2026-09-06. The default free route is **pure text-to-video with H3 Max Turbo**. The retained H3 Max reference-to-video route is a separately priced feature, currently disabled pending merchant setup, input-cost verification and fulfillment acceptance. Images are optional character cards and story covers; they are not sent to this model route and are not a prerequisite for video creation. Free creation does not depend on an image-generation service.

## Contributor experience

The composer lists this story’s established cast under **Choose characters**. Selection is optional: contributors can use a name in free text or let the director choose. Up to three characters can be selected for a ten-second scene. Larger casts have search. A portrait appears when available; otherwise initials are shown. The list explicitly shows the latest cast, while the reading guide follows playback position to avoid future introductions.

Selected IDs are saved with the proposal, included in idempotency comparisons, hidden from other contributors before publication and passed to the director again when the queue reaches the idea. Database constraints reject duplicate, foreign and not-yet-introduced IDs. The director uses current states. A cast substitution requires review and the preview shows who will appear.

The public guide includes reviewed introductions, development, relationships, source scenes and historical states. A candidate becomes an established character only after its first reviewed scene is published. Normalized name checks prevent some duplicate identities; uncertain aliases still need review.

## Textual continuity

Every outgoing text-only request contains the selected characters’ full names, fixed descriptions, latest state and the reviewed story bridge. The request snapshot records exactly those textual identities and the model used. Neither character images nor preceding videos are attached, even if the database contains image URLs. Budget checks use the announced regular Turbo rate, not a temporary discount.

A fixed ID keeps the database identity stable. A fixed description helps the model reproduce recognizable traits but cannot lock an exact face or voice across independent samples. Reusing a seed is also not a character-identity mechanism. Do not promise image-conditioned continuity in this mode.

For the first worlds, favor a consistent illustrated style, a small cast and distinct silhouettes, hair, clothing colors and props. Keep those anchors unchanged unless a published event explicitly changes them. Use self-contained action beats with clear endings; continuity is narrative and editorial rather than a guaranteed seamless camera shot.

## Public-domain characters

A familiar literary character may improve recognizability; model familiarity is a hypothesis to test, not a proof of visual consistency or permission. A model can blend several adaptations. Specify an original interpretation of the underlying story, with a fixed descriptive design, instead of asking for an actor or a modern franchise’s particular costume.

Candidate source material includes the original Sherlock Holmes stories, Dracula and Alice’s Adventures in Wonderland, which are in the US public domain. Classic Grimm tales offer strongly recognizable characters such as Little Red Riding Hood and the wolf. Each template should record the underlying edition/source, jurisdiction reviewed, allowed core traits and the original design specification. A US public-domain finding is not a worldwide rights clearance. Modern translations, illustrations, films and newly added designs can retain their own copyright; trademark and misleading affiliation also require separate consideration.

No public character-template catalog or final launch story has been selected or published. The Sherlock Holmes sample is an isolated model test using a newly described illustrated interpretation.

Sources checked 2026-09-06: [Duke public-domain guidance](https://web.law.duke.edu/cspd/publicdomainday/2026/), [US Copyright Office on derivative works](https://copyright.gov/circs/circ14.pdf), [Grimm source edition and US status](https://www.gutenberg.org/ebooks/5314).

## Images and paid reference mode

Character cards can retain a portrait as a viewing aid. The text-only video model does not see it. Automatic image generation and creator-facing portrait confirmation are deferred from the video critical path.

The earlier reference-to-video adapter, curated materials, material version history and exact request snapshots remain in the paid reference path. Preserve the original approved image as an immutable anchor. Reviewed video frames can supplement it; they should not automatically overwrite it. Costume changes, injury and aging need appearance revisions and historical display rules. Transparent cutouts are not required for image reference use.

Before release, test independent text-only clips across returning characters, two-character dialogue, prop handoffs and new entrants. Count rejected outputs and retries in cost per accepted scene. The small experiments do not establish long-run consistency, English enforcement or acceptable commercial reliability.

Official model references: [Turbo text-only API](https://fal.ai/models/minimax/h3-max-turbo/text-to-video/api), [regular and promotional pricing](https://fal.ai/models/minimax/h3-max-turbo/text-to-video).
