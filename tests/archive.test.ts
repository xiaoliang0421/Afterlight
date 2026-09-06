import test from "node:test";
import assert from "node:assert/strict";
import {
  fallbackArchive,
  validateArchive,
  type ArchiveContext,
} from "../shared/archive";
import { validatePlan } from "../shared/domain";
const context: ArchiveContext = {
  title: "The coast",
  premise: "A lighthouse mystery",
  version: 2,
  characters: [
    {
      id: "mara",
      name: "Mara Vale",
      description: "The keeper",
      state: "At the lighthouse",
      introducedVersion: 0,
    },
    {
      id: "june",
      name: "June",
      description: "A courier",
      state: "At the door",
      introducedVersion: 2,
    },
  ],
  scenes: [
    {
      id: "scene-1",
      version: 1,
      title: "The arrival",
      summary: "Mara arrives at the lighthouse.",
    },
    {
      id: "scene-2",
      version: 2,
      title: "The courier",
      summary: "June gives Mara an envelope.",
    },
  ],
};
test("story guide rejects foreign IDs, future references and evidence before a character's introduction", () => {
  const draft = fallbackArchive(context);
  assert.equal(validateArchive(draft, context).recap.sceneIds[0], "scene-2");
  const base = {
    id: "june",
    introduction: "A courier",
    development: "She delivers an envelope.",
    sceneIds: ["scene-2"],
    relationships: [],
  };
  draft.characters = [base];
  assert.equal(validateArchive(draft, context).characters[0].id, "june");
  assert.throws(
    () =>
      validateArchive(
        { ...draft, characters: [{ ...base, id: "inez" }] },
        context,
      ),
    /Unknown/,
  );
  assert.throws(
    () => validateArchive({ ...draft, characters: [base, base] }, context),
    /duplicate/,
  );
  assert.throws(
    () =>
      validateArchive(
        { ...draft, characters: [{ ...base, sceneIds: ["scene-3"] }] },
        context,
      ),
    /unavailable/,
  );
  assert.throws(
    () =>
      validateArchive(
        { ...draft, characters: [{ ...base, sceneIds: ["scene-1"] }] },
        context,
      ),
    /precedes/,
  );
  assert.throws(
    () =>
      validateArchive(
        {
          ...draft,
          characters: [
            {
              ...base,
              relationships: [
                {
                  characterId: "mara",
                  description: "They meet.",
                  sceneIds: ["scene-1"],
                },
              ],
            },
          ],
        },
        context,
      ),
    /precedes/,
  );
});
test("name normalization prevents creating a second identity through case, spacing or full-width letters", () => {
  assert.throws(
    () =>
      validatePlan(
        {
          newCharacters: [{ id: "new-id", name: "  ＭＡＲＡ   ＶＡＬＥ  " }],
          characterIds: [],
          characterUpdates: [],
        } as any,
        context.characters as any,
      ),
    /already exists/,
  );
});
