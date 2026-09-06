import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { probeMp4, trustedFalUrl } from "../worker/media";
import {
  sceneAt,
  nextReset,
  periodKeys,
  validatePlan,
  type Scene,
  type ScenePlan,
} from "../shared/domain";

test("MP4 duration is probed from metadata without loading video payload", async () => {
  const data = readFileSync("public/samples/playback.mp4");
  let read = 0;
  const ms = await probeMp4(async (offset, length) => {
    read += length;
    return new Uint8Array(data.subarray(offset, offset + length)).buffer;
  }, data.length);
  assert.equal(ms, 10000);
  assert.ok(read < data.length / 2);
});
test("malformed MP4 and unsafe provider URLs fail closed", async () => {
  await assert.rejects(
    () => probeMp4(async () => new ArrayBuffer(8), 8),
    /inspection/,
  );
  for (const url of [
    "http://fal.media/a",
    "https://fal.media.attacker.test/a",
    "https://queue.fal.run@attacker.test/a",
    "https://localhost/a",
  ])
    assert.throws(() => trustedFalUrl(url));
  assert.equal(
    trustedFalUrl("https://v3.fal.media/video/a.mp4").hostname,
    "v3.fal.media",
  );
  assert.throws(() => trustedFalUrl("https://media.queue.fal.run/a", true));
});
test("scene provenance at a boundary selects the next author; exact end belongs to the final scene", () => {
  const scenes = [
    { id: "a", startMs: 0, durationMs: 10000 },
    { id: "b", startMs: 10000, durationMs: 9000 },
  ] as Scene[];
  assert.equal(sceneAt(scenes, 9999)?.id, "a");
  assert.equal(sceneAt(scenes, 10000)?.id, "b");
  assert.equal(sceneAt(scenes, 19000)?.id, "b");
  assert.equal(sceneAt(scenes, 19001), undefined);
});
test("credit resets use UTC across month boundaries", () => {
  const time = Date.parse("2026-09-30T23:59:59Z");
  assert.equal(
    new Date(nextReset(time)).toISOString(),
    "2026-10-01T00:00:00.000Z",
  );
  assert.deepEqual(periodKeys(time), { day: "2026-09-30", month: "2026-09" });
});
test("character references cannot cross story boundaries or reuse a permanent ID", () => {
  const plan = {
    newCharacters: [],
    characterIds: ["foreign"],
    characterUpdates: [],
  } as unknown as ScenePlan;
  assert.throws(() => validatePlan(plan, []), /outside this story/);
  assert.throws(
    () =>
      validatePlan(
        {
          ...plan,
          newCharacters: [
            { id: "same" },
            { id: "same" },
          ] as ScenePlan["newCharacters"],
          characterIds: [],
        },
        [],
      ),
    /reuse|Duplicate/,
  );
});
