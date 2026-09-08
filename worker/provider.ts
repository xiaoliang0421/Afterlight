import { z } from "zod";
import { validatePlan, type ScenePlan } from "../shared/domain";
import { AppError } from "./errors";
import { getSettings, getCharacters, getStory, type TaskRow } from "./store";
import { selectedMaterials } from "./materials";
import { trustedFalUrl } from "./media";
import { assertVideoReservation } from "./pricing";
import { videoMode, assertTextVideoReservation } from "./video-policy";
import { generationOffer, paidWallet } from "./billing";

export function textVideoInput(
  plan: ScenePlan,
  cast: { id: string; name: string; description: string; state: string }[],
  world: { worldRules: string; visualStyle: string },
) {
  const selected = plan.characterIds.map((id) => {
    const ch = cast.find((c) => c.id === id);
    if (!ch)
      throw new AppError(
        "invalid_cast",
        "This scene’s characters need another continuity review.",
        409,
      );
    return {
      id: ch.id,
      name: ch.name,
      description: ch.description,
      state: ch.state,
    };
  });
  return {
    input: {
      prompt: `FIXED STORY SETTING — preserve the period, location, lighting and world rules:\n${world.worldRules}\nFIXED VISUAL STYLE — apply throughout every shot:\n${world.visualStyle}\nSCENE ACTION:\n${plan.videoPrompt}\nCHARACTER DESCRIPTIONS — retain these recognizable traits throughout the scene:\n${selected.map((ch) => `${ch.name}: ${ch.description}\nCurrent story state: ${ch.state}`).join("\n")}\nStory connection: ${plan.bridge}\nAll dialogue, narration, lyrics and readable text must be English. No unrelated text overlays. Preserve the stated clothes, hair, props and scene conditions.`,
      duration: 10,
      resolution: "768P",
      aspect_ratio: "16:9",
      prompt_expansion_mode: "balanced",
      enable_safety_checker: true,
    },
    characters: selected,
  };
}

const queueResponse = z.object({
  request_id: z.string().min(1),
  status_url: z.string().url(),
  response_url: z.string().url(),
});
const resultResponse = z.object({ video: z.object({ url: z.string().url() }) });
export async function prepareVideoRequest(
  env: Cloudflare.Env,
  task: TaskRow,
  plan: ScenePlan,
) {
  if (!env.FAL_KEY || String(env.PROVIDER_MODE) !== "live")
    throw new AppError(
      "provider_unavailable",
      "Video generation is not configured yet.",
      503,
    );
  if (task.source_kind === "upload")
    throw new AppError(
      "upload_cannot_generate",
      "An uploaded video cannot call the generation provider.",
      409,
    );
  const settings = await getSettings(env);
  if (
    !settings.generationEnabled ||
    settings.providerCheckedAt < Date.now() - 300000 ||
    settings.providerBalanceCents - settings.providerDebitedCents <
      settings.providerReservedCents
  )
    throw new AppError(
      "provider_capacity",
      "Creation capacity needs to be checked before this scene starts.",
      503,
    );
  const model = task.provider_model;
  if (task.billing_kind === "points" || task.generation_mode === "reference") {
    const wallet = await paidWallet(env, task.user_id);
    if (
      (task.generation_mode === "reference" &&
        !(await generationOffer(env)).referenceEnabled) ||
      wallet.held ||
      !wallet.covered ||
      wallet.reserved < task.quoted_points
    )
      throw new AppError(
        "paid_credits_unavailable",
        "Paid creation is paused while the reserved points are checked.",
        409,
      );
  }
  if (videoMode(model) === "text") {
    const canonical = await getCharacters(env, task.story_id);
    const { worldRules, visualStyle } = await getStory(env, task.story_id);
    const world = { worldRules, visualStyle };
    validatePlan(plan, canonical);
    assertTextVideoReservation(task.reserved_cents, 10);
    const prepared = textVideoInput(
      plan,
      [...canonical, ...plan.newCharacters],
      world,
    );
    await env.DB.prepare("UPDATE tasks SET material_snapshot_json=? WHERE id=?")
      .bind(
        JSON.stringify({
          mode: "text",
          model,
          world,
          characters: prepared.characters,
          previousSceneId: null,
        }),
        task.id,
      )
      .run();
    return prepared.input;
  }
  const selected = await selectedMaterials(env, task.id, task.story_id, plan);
  // Only curated references stored by an owner/admin are used; model-supplied URLs are never fetched.
  const images = selected.map((c) => c!.referenceImage!);
  if (images.some((u) => !u.startsWith("https://")))
    throw new AppError(
      "references_required",
      "Character references must have approved HTTPS delivery addresses.",
      409,
    );
  const voiced = selected.filter((c) => c.voiceReference);
  const lastScene = await env.DB.prepare(
    "SELECT id,duration_ms,fixture FROM scenes WHERE story_id=? AND hidden=0 ORDER BY version DESC LIMIT 1",
  )
    .bind(task.story_id)
    .first<{ id: string; duration_ms: number; fixture: number }>();
  const videoRefs =
    lastScene &&
    !lastScene.fixture &&
    lastScene.duration_ms >= 2000 &&
    lastScene.duration_ms <= 15000
      ? [new URL(`/api/scenes/${lastScene.id}/video`, env.PUBLIC_ORIGIN).href]
      : [];
  assertVideoReservation(task.reserved_cents, {
    outputSeconds: 10,
    previousVideoMs: videoRefs.length ? lastScene!.duration_ms : 0,
    voiceMs: voiced.reduce(
      (sum, material) => sum + (material.voiceDurationMs ?? 0),
      0,
    ),
  });
  const prompt = `${plan.videoPrompt}\n${selected.map((c, i) => `Image ${i + 1} is ${c!.name}; preserve their face and appearance.`).join("\n")}\n${voiced.map((c, i) => `Audio ${i + 1} is ${c.name}'s approved voice reference.`).join("\n")}\n${videoRefs.length ? "Video 1 is the preceding published scene. Continue from its final moment, preserving screen direction, props, atmosphere and completed dialogue." : ""}\nAll dialogue, narration, lyrics, subtitles and readable text are in English. Maintain the approved characters and continue the preceding scene. No unrelated text overlays.`;
  await env.DB.prepare("UPDATE tasks SET material_snapshot_json=? WHERE id=?")
    .bind(
      JSON.stringify({
        mode: "reference",
        model,
        characters: selected,
        previousSceneId: videoRefs.length ? lastScene!.id : null,
      }),
      task.id,
    )
    .run();
  return {
    prompt,
    duration: 10,
    resolution: "768P",
    aspect_ratio: "16:9",
    prompt_expansion_mode: "balanced",
    enable_safety_checker: true,
    reference_image_urls: images,
    reference_audio_urls: voiced.map((c) => c.voiceReference!),
    reference_video_urls: videoRefs,
  };
}
export async function submitVideo(
  env: Cloudflare.Env,
  request: Awaited<ReturnType<typeof prepareVideoRequest>>,
  model: string,
) {
  videoMode(model);
  const response = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      Authorization: `Key ${env.FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok)
    throw new AppError(
      "provider_submission_uncertain",
      "The provider response needs reconciliation before another generation can be attempted.",
      503,
    );
  const result = queueResponse.parse(await response.json());
  trustedFalUrl(result.status_url, true);
  trustedFalUrl(result.response_url, true);
  return result;
}
export async function pollVideo(env: Cloudflare.Env, task: TaskRow) {
  if (!task.provider_status_url || !env.FAL_KEY)
    throw new AppError(
      "provider_request_missing",
      "The provider request needs reconciliation.",
      409,
    );
  const response = await fetch(trustedFalUrl(task.provider_status_url, true), {
    redirect: "manual",
    headers: { Authorization: `Key ${env.FAL_KEY}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new AppError(
      "provider_poll_failed",
      "The provider status could not be checked.",
      503,
    );
  const data = await response.json<{ status: string; error?: string }>();
  if (data.status === "COMPLETED") {
    if (data.error || !task.provider_result_url)
      return { status: "failed" as const };
    const result = await fetch(trustedFalUrl(task.provider_result_url, true), {
      redirect: "manual",
      headers: { Authorization: `Key ${env.FAL_KEY}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!result.ok) return { status: "failed" as const };
    const video = resultResponse.safeParse(await result.json());
    if (!video.success) return { status: "failed" as const };
    trustedFalUrl(video.data.video.url);
    return { status: "complete" as const, url: video.data.video.url };
  }
  if (!["IN_QUEUE", "IN_PROGRESS"].includes(data.status))
    throw new AppError(
      "unknown_provider_status",
      "The provider returned a status requiring reconciliation.",
      503,
    );
  return { status: "waiting" as const };
}
