import { z } from "zod";
import { AppError } from "./errors";
import type { ScenePlan } from "../shared/domain";
export const materialSchema = z
  .object({
    referenceImage: z.string().url(),
    voiceReference: z.string().url().optional(),
    voiceDurationMs: z.number().int().min(2000).max(5000).optional(),
  })
  .refine(
    (x) => Boolean(x.voiceReference) === Boolean(x.voiceDurationMs),
    "A voice reference needs a verified 2–5 second duration.",
  );
export function approvedReference(raw: string) {
  const u = new URL(raw);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && !["443"].includes(u.port)) ||
    !u.hostname.includes(".") ||
    /^(localhost|127\.|10\.|0\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|\[)/.test(
      u.hostname,
    ) ||
    u.hostname.endsWith(".local")
  )
    throw new AppError(
      "invalid_reference",
      "Use an approved public HTTPS material address.",
      400,
    );
  return u.href;
}
export interface ReferenceMaterial {
  id: string;
  name: string;
  description: string;
  referenceImage: string;
  voiceReference: string | null;
  voiceDurationMs: number | null;
  materialVersion: number;
}
export async function selectedMaterials(
  env: Cloudflare.Env,
  taskId: string,
  storyId: string,
  plan: ScenePlan,
): Promise<ReferenceMaterial[]> {
  const canonical = (
    await env.DB.prepare(
      "SELECT id,name,description,reference_image AS referenceImage,voice_reference AS voiceReference,voice_duration_ms AS voiceDurationMs,material_version AS materialVersion FROM characters WHERE story_id=?",
    )
      .bind(storyId)
      .all<ReferenceMaterial>()
  ).results;
  const candidates = (
    await env.DB.prepare(
      "SELECT character_id AS id,name,description,reference_image AS referenceImage,voice_reference AS voiceReference,voice_duration_ms AS voiceDurationMs,approved_at AS materialVersion FROM candidate_materials WHERE task_id=? AND story_id=?",
    )
      .bind(taskId, storyId)
      .all<ReferenceMaterial>()
  ).results;
  return plan.characterIds.map((id) => {
    const candidate = plan.newCharacters.find((c) => c.id === id);
    const material = candidate
      ? candidates.find(
          (c) =>
            c.id === id &&
            c.name === candidate.name &&
            c.description === candidate.description,
        )
      : canonical.find((c) => c.id === id);
    if (!material?.referenceImage)
      throw new AppError(
        "references_required",
        "The studio needs to approve this scene’s character materials. Your idea stays saved; no video generation has started.",
        409,
      );
    approvedReference(material.referenceImage);
    if (material.voiceReference) approvedReference(material.voiceReference);
    return material;
  });
}
