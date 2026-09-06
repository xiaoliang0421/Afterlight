import test from "node:test";
import assert from "node:assert/strict";
import { prepareVideoRequest, textVideoInput } from "../worker/provider";
import { videoMode, assertTextVideoReservation } from "../worker/video-policy";
import type { Character, ScenePlan } from "../shared/domain";
import type { TaskRow } from "../worker/store";

const mara: Character = {
  id: "mara",
  storyId: "world",
  name: "Mara",
  description: "Short black hair, rust-orange coat and a silver pin.",
  state: "Holding a sealed letter beside the desk.",
  introducedVersion: 0,
  referenceImage: "https://example.com/portrait.png",
};
const june = {
  id: "candidate-june",
  name: "June",
  description: "A courier in a blue canvas jacket with a white scarf.",
  state: "Outside the closed door.",
};
const plan: ScenePlan = {
  englishPrompt: "Mara answers a knock from the courier.",
  title: "A caller",
  summary: "Mara listens beside the door as June announces a delivery.",
  bridge: "Mara keeps the letter in her hand and turns toward the door.",
  videoPrompt:
    "One continuous medium shot of Mara by the desk, looking toward a closed door after a knock.",
  language: "en",
  durationSeconds: 10,
  characterIds: ["mara", "candidate-june"],
  newCharacters: [june],
  characterUpdates: [],
  proposedEvents: [],
  requiresReview: false,
  majorChanges: [],
  reason: "",
  rejected: false,
};

test("text-only preparation needs no reference assets and records the exact textual identities", async () => {
  let snapshot = "";
  const env = {
    PROVIDER_MODE: "live",
    FAL_KEY: "test-key-only",
    FAL_MODEL: "minimax/h3-max-turbo/text-to-video",
    DB: {
      prepare: (query: string) => {
        if (query.includes("FROM settings JOIN provider_wallet"))
          return {
            first: async () => ({
              generationEnabled: true,
              providerCheckedAt: Date.now(),
              providerBalanceCents: 1000,
              providerDebitedCents: 0,
              providerReservedCents: 150,
            }),
          };
        if (query.startsWith("SELECT id,story_id AS storyId"))
          return { bind: () => ({ all: async () => ({ results: [mara] }) }) };
        if (query === "UPDATE tasks SET material_snapshot_json=? WHERE id=?")
          return {
            bind: (value: string) => ({
              run: async () => {
                snapshot = value;
              },
            }),
          };
        throw new Error(
          "Text mode must not query previous media or require candidate image approval.",
        );
      },
    },
  } as unknown as Cloudflare.Env;
  const input = await prepareVideoRequest(
    env,
    {
      id: "task",
      story_id: "world",
      provider_model: "minimax/h3-max-turbo/text-to-video",
      reserved_cents: 50,
    } as TaskRow,
    plan,
  );
  assert.deepEqual(Object.keys(input).sort(), [
    "aspect_ratio",
    "duration",
    "enable_safety_checker",
    "prompt",
    "prompt_expansion_mode",
    "resolution",
  ]);
  assert.ok(input.prompt.includes(mara.description));
  assert.ok(input.prompt.includes(june.description));
  assert.ok(!JSON.stringify(input).includes("example.com"));
  assert.deepEqual(
    JSON.parse(snapshot).characters.map((c: { id: string }) => c.id),
    ["mara", "candidate-june"],
  );
  assert.equal(JSON.parse(snapshot).mode, "text");
  assert.equal(JSON.parse(snapshot).previousSceneId, null);
  await assert.rejects(
    () =>
      prepareVideoRequest(
        env,
        {
          id: "task",
          story_id: "world",
          provider_model: "minimax/h3-max-turbo/text-to-video",
          reserved_cents: 39,
        } as TaskRow,
        plan,
      ),
    /capacity/,
  );
});

test("text model pricing ignores temporary discounts and rejects unreviewed model routes", () => {
  assert.equal(videoMode("minimax/h3-max-turbo/text-to-video"), "text");
  assert.throws(
    () => videoMode("minimax/h3-max-turbo/image-to-video"),
    /reviewed cost/,
  );
  assert.doesNotThrow(() => assertTextVideoReservation(40, 10));
  for (const value of [39, NaN, -1])
    assert.throws(() => assertTextVideoReservation(value, 10));
  assert.throws(
    () => textVideoInput({ ...plan, characterIds: ["foreign"] }, [mara, june]),
    /continuity review/,
  );
});
