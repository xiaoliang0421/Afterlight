// Explicit, resumable two-clip fal experiment. Never imported by the application.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { trustedFalUrl, probeMp4 } from "../worker/media";
import {
  lockExperiment,
  audioReservations,
  lowCostReservations,
} from "./experiment-budget";

const directory = resolve("artifacts/fal-smoke"),
  journal = resolve(directory, "journal.json");
const model = "minimax/h3-max/reference-to-video",
  budgetCents = 500;
const key = process.env.FAL_KEY;
if (!key || !process.argv.includes("--authorized-5-usd"))
  throw new Error("A fal key and explicit US$5 authorization are required.");
const headers = {
  Authorization: `Key ${key}`,
  "Content-Type": "application/json",
};
type Clip = {
  attemptedAt: string;
  reservedCents: number;
  estimatedCents: number;
  prompt: string;
  status: string;
  requestId?: string;
  statusUrl?: string;
  resultUrl?: string;
  videoUrl?: string;
  durationMs?: number;
  httpStatus?: number;
  error?: string;
};
type Journal = { budgetCents: number; model: string; clips: Clip[] };
mkdirSync(directory, { recursive: true });
lockExperiment();
let state: Journal = existsSync(journal)
  ? JSON.parse(readFileSync(journal, "utf8"))
  : { budgetCents, model, clips: [] };
const save = () =>
  writeFileSync(journal, JSON.stringify(state, null, 2) + "\n", {
    mode: 0o600,
  });
const action = process.argv.find((x) =>
  ["--submit-first", "--submit-second", "--poll"].includes(x),
);
try {
  if (action === "--poll") {
    const clip = state.clips.at(-1);
    if (!clip?.statusUrl || !clip.resultUrl)
      throw new Error(
        "No recorded provider request to poll. Reconcile any uncertain submit first.",
      );
    for (let i = 0; i < 90; i++) {
      const r = await fetch(trustedFalUrl(clip.statusUrl, true), {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok)
        throw new Error(
          `Status lookup HTTP ${r.status}; the existing request is preserved.`,
        );
      const status = (await r.json()) as { status: string; error?: string };
      if (status.status === "COMPLETED") {
        const result = await fetch(trustedFalUrl(clip.resultUrl, true), {
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(20000),
        });
        if (!result.ok) {
          clip.status = "failed";
          clip.httpStatus = result.status;
          save();
          throw new Error(
            `Provider result HTTP ${result.status}. No automatic repeat.`,
          );
        }
        const output = (await result.json()) as { video?: { url: string } };
        if (!output.video?.url)
          throw new Error(
            "No video in the provider result. Reconcile this request.",
          );
        const media = await fetch(trustedFalUrl(output.video.url), {
          redirect: "error",
          signal: AbortSignal.timeout(60000),
        });
        if (
          !media.ok ||
          Number(media.headers.get("content-length") ?? 0) > 64 * 1024 * 1024
        )
          throw new Error("Output could not be safely stored.");
        const bytes = Buffer.from(await media.arrayBuffer());
        if (bytes.length > 64 * 1024 * 1024)
          throw new Error("Output too large.");
        const duration = await probeMp4(async (o, n) => {
          const b = bytes.subarray(o, o + n);
          return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
        }, bytes.length);
        const file = resolve(directory, `clip-${state.clips.length}.mp4`);
        writeFileSync(file, bytes);
        clip.videoUrl = output.video.url;
        clip.durationMs = duration;
        clip.status = "stored";
        save();
        console.log(
          JSON.stringify({
            status: "stored",
            file,
            durationMs: duration,
            requestId: clip.requestId,
          }),
        );
        process.exit(0);
      }
      if (!["IN_QUEUE", "IN_PROGRESS"].includes(status.status))
        throw new Error(
          "Unexpected provider state. Existing request preserved.",
        );
      console.log(
        JSON.stringify({ status: status.status, requestId: clip.requestId }),
      );
      await new Promise((r) => setTimeout(r, 10000));
    }
    throw new Error(
      "Polling paused. Continue polling the recorded request; do not resubmit.",
    );
  }
  const second = action === "--submit-second";
  if (!second && action !== "--submit-first")
    throw new Error("Choose a submit stage or poll.");
  if (state.clips.length !== (second ? 1 : 0))
    throw new Error(
      "This stage has already been attempted; do not repeat a paid submission.",
    );
  const preceding = state.clips[0];
  if (
    second &&
    (preceding.status !== "stored" ||
      !process.argv.includes("--first-reviewed") ||
      !preceding.videoUrl ||
      !preceding.durationMs ||
      preceding.durationMs > 15000)
  )
    throw new Error("Review the stored first clip before continuing.");
  const image = readFileSync("public/art/characters/mara-vale-v1.png");
  if (image.subarray(1, 4).toString() !== "PNG")
    throw new Error("Expected the approved PNG reference.");
  const width = image.readUInt32BE(16),
    height = image.readUInt32BE(20);
  const tokens =
    (width * height) / 1024 +
    (second ? (preceding.durationMs! / 1000) * 7459.2 : 0);
  const estimate = Math.ceil(80 + Math.max(0, tokens - 4096) * 0.002),
    reserve = second ? 300 : 100;
  if (
    estimate > reserve ||
    state.clips.reduce((n, c) => n + c.reservedCents, 0) +
      audioReservations() +
      lowCostReservations() +
      reserve >
      budgetCents
  )
    throw new Error(
      "This request would exceed the authorized budget or reviewed price allowance.",
    );
  const common =
    "Image 1 is Mara Vale, the only person in the scene. Preserve her exact face, short dark hair, rust-orange raincoat, dark sweater and small brass key. Original fictional British lighthouse keeper in 1987. Restrained photorealistic coastal mystery. Overcast slate light, a light steady drizzle throughout, distant surf, subtle wind. Native lip-synced English speech, natural quiet British female voice. No music, no subtitles, no logos, no readable text overlays. One continuous shot, no montage.";
  const prompt =
    common +
    (second
      ? " Video 1 is the immediately preceding scene. Begin at its final pose and camera position; preserve the same voice, face, weather, door and key. Mara keeps the brass key in her right hand. A soft knock is heard from behind the closed brass door. She stops moving, raises her eyes toward the door, and quietly says in English, 'Someone is inside.' She remains outside; the door stays fully closed. End with her listening."
      : " Medium close-up at the lighthouse entrance next to a closed narrow brass door. Mara holds the brass key in her right hand. She slowly lifts it toward her eyes, examines the small marks, and quietly says in English, 'This key belongs here.' She lowers it slightly and looks toward the door. End with her facing the still-closed door, key in her right hand. Only these two simple actions over ten seconds.");
  const clip: Clip = {
    attemptedAt: new Date().toISOString(),
    reservedCents: reserve,
    estimatedCents: estimate,
    prompt,
    status: "attempted",
  };
  state.clips.push(clip);
  save(); // Durable marker BEFORE paid network I/O.
  const response = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers,
    redirect: "error",
    body: JSON.stringify({
      prompt,
      duration: 10,
      resolution: "768P",
      aspect_ratio: "16:9",
      prompt_expansion_mode: "balanced",
      enable_safety_checker: true,
      reference_image_urls: [
        `data:image/png;base64,${image.toString("base64")}`,
      ],
      reference_video_urls: second ? [preceding.videoUrl] : [],
    }),
    signal: AbortSignal.timeout(45000),
  });
  clip.httpStatus = response.status;
  if (!response.ok) {
    clip.status = "response-error";
    const body = (await response.text())
      .slice(0, 800)
      .split(key)
      .join("[redacted]");
    clip.error = body;
    save();
    console.log(
      JSON.stringify({
        status: clip.status,
        httpStatus: response.status,
        message: body,
      }),
    );
    process.exit(1);
  }
  const receipt = (await response.json()) as {
    request_id: string;
    status_url: string;
    response_url: string;
  };
  trustedFalUrl(receipt.status_url, true);
  trustedFalUrl(receipt.response_url, true);
  clip.requestId = receipt.request_id;
  clip.statusUrl = receipt.status_url;
  clip.resultUrl = receipt.response_url;
  clip.status = "submitted";
  save();
  console.log(
    JSON.stringify({
      status: "submitted",
      requestId: clip.requestId,
      estimatedCents: estimate,
      reservedCents: reserve,
      totalReservedCents: state.clips.reduce((n, c) => n + c.reservedCents, 0),
      budgetCents,
    }),
  );
} catch (e) {
  console.error(
    e instanceof Error
      ? e.message.split(key).join("[redacted]")
      : "Experiment stopped.",
  );
  process.exitCode = 1;
}
