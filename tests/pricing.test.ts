import test from "node:test";
import assert from "node:assert/strict";
import {
  assertVideoReservation,
  h3KnownCostFloorCents,
} from "../worker/pricing";

test("continuation cost includes the preceding video, not just ten output seconds", () => {
  const continued = { outputSeconds: 10, previousVideoMs: 10000, voiceMs: 0 };
  assert.equal(h3KnownCostFloorCents({ ...continued, previousVideoMs: 0 }), 80);
  assert.equal(h3KnownCostFloorCents(continued), 221);
  assert.throws(
    () => assertVideoReservation(150, continued),
    /studio needs to review/,
  );
  assert.doesNotThrow(() => assertVideoReservation(300, continued));
});

test("voice reference tokens share the allowance and invalid costs fail closed", () => {
  assert.equal(
    h3KnownCostFloorCents({
      outputSeconds: 10,
      previousVideoMs: 10000,
      voiceMs: 15000,
    }),
    224,
  );
  assert.throws(() =>
    h3KnownCostFloorCents({
      outputSeconds: 10,
      previousVideoMs: NaN,
      voiceMs: 0,
    }),
  );
});
