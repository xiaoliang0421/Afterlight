import { z } from "zod";
const text = z.string().trim().min(1).max(1200);
const sources = z.array(z.string().min(1)).min(1).max(8);
export const archiveSchema = z.object({
  language: z.literal("en"),
  recap: z.object({ text, sceneIds: sources }),
  characters: z
    .array(
      z.object({
        id: z.string().min(1),
        introduction: text,
        development: text,
        sceneIds: sources,
        relationships: z
          .array(
            z.object({
              characterId: z.string().min(1),
              description: text,
              sceneIds: sources,
            }),
          )
          .max(8),
      }),
    )
    .max(20),
  openThreads: z.array(z.object({ text, sceneIds: sources })).max(10),
  concerns: z.array(z.object({ text, sceneIds: sources })).max(10),
});
export type Archive = z.infer<typeof archiveSchema>;
export interface ArchiveContext {
  title: string;
  premise: string;
  version: number;
  characters: {
    id: string;
    name: string;
    description: string;
    state: string;
    introducedVersion: number;
  }[];
  scenes: { id: string; version: number; title: string; summary: string }[];
}
export function validateArchive(
  value: unknown,
  context: ArchiveContext,
): Archive {
  const data = archiveSchema.parse(value);
  const characters = new Set(context.characters.map((c) => c.id));
  const scenes = new Set(context.scenes.map((s) => s.id));
  const check = (ids: string[]) => {
    if (ids.some((id) => !scenes.has(id)))
      throw new Error(
        "Archive references an unavailable scene or another story.",
      );
  };
  check(data.recap.sceneIds);
  const seen = new Set<string>();
  for (const c of data.characters) {
    if (!characters.has(c.id) || seen.has(c.id))
      throw new Error("Unknown or duplicate character identity.");
    seen.add(c.id);
    check(c.sceneIds);
    const introduction = context.characters.find(
      (x) => x.id === c.id,
    )!.introducedVersion;
    if (
      c.sceneIds.some(
        (id) => context.scenes.find((s) => s.id === id)!.version < introduction,
      )
    )
      throw new Error("Character citation precedes their introduction.");
    for (const r of c.relationships) {
      if (!characters.has(r.characterId) || r.characterId === c.id)
        throw new Error("Invalid relationship identity.");
      check(r.sceneIds);
      const target = context.characters.find((x) => x.id === r.characterId)!;
      if (
        r.sceneIds.some(
          (id) =>
            context.scenes.find((s) => s.id === id)!.version <
            Math.max(introduction, target.introducedVersion),
        )
      )
        throw new Error(
          "Relationship citation precedes a character's introduction.",
        );
    }
  }
  [...data.openThreads, ...data.concerns].forEach((x) => check(x.sceneIds));
  return data;
}
export function fallbackArchive(context: ArchiveContext): Archive {
  const last = context.scenes.at(-1)!;
  return {
    language: "en",
    recap: { text: last.summary, sceneIds: [last.id] },
    characters: [],
    openThreads: [],
    concerns: [],
  };
}
