// Two independent text-only samples inside the original US$5 authorization.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  lockExperiment,
  originalExperimentCommitment,
  lowCostReservations,
} from "./experiment-budget";
import { trustedFalUrl, probeMp4 } from "../worker/media";

const key = process.env.FAL_KEY;
if (!key || !process.argv.includes("--authorized-5-usd"))
  throw new Error(
    "The original US$5 authorization and a fal key are required.",
  );
const model = "minimax/h3-max-turbo/text-to-video";
const dir = "artifacts/fal-smoke",
  file = `${dir}/low-cost.json`;
lockExperiment();
type Clip = {
  prompt: string;
  status: string;
  reservedCents: number;
  requestId?: string;
  statusUrl?: string;
  resultUrl?: string;
  attemptedAt: string;
  submittedAt?: string;
  observedCompleteAt?: string;
  durationMs?: number;
  file?: string;
  inferenceSeconds?: number;
};
const journal: { model: string; clips: Clip[] } = existsSync(file)
  ? JSON.parse(readFileSync(file, "utf8"))
  : { model, clips: [] };
if (journal.model !== model)
  throw new Error("Do not change models inside an existing experiment.");
const save = () =>
  writeFileSync(file, JSON.stringify(journal, null, 2) + "\n", { mode: 0o600 });
const headers = {
  Authorization: `Key ${key}`,
  "Content-Type": "application/json",
};
const action = process.argv.find((x) =>
  ["--submit-first", "--submit-second", "--poll"].includes(x),
);
try {
  if (action === "--poll") {
    const c = journal.clips.at(-1);
    if (!c?.statusUrl || !c.resultUrl)
      throw new Error(
        "No known request. Reconcile uncertain submission; do not repeat.",
      );
    if (c.status === "stored") {
      console.log(JSON.stringify(c));
      process.exit(0);
    }
    const r = await fetch(trustedFalUrl(c.statusUrl, true), {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok)
      throw new Error(`Status lookup HTTP ${r.status}; preserve the request.`);
    const status = (await r.json()) as { status: string };
    if (status.status !== "COMPLETED") {
      console.log(
        JSON.stringify({ status: status.status, requestId: c.requestId }),
      );
      process.exit(0);
    }
    const result = await fetch(trustedFalUrl(c.resultUrl, true), {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (!result.ok)
      throw new Error(`Result HTTP ${result.status}; do not resubmit.`);
    const out = (await result.json()) as {
      video: { url: string };
      timings?: { inference?: number };
    };
    const media = await fetch(trustedFalUrl(out.video.url), {
      redirect: "error",
      signal: AbortSignal.timeout(60000),
    });
    const size = Number(media.headers.get("content-length"));
    if (
      !media.ok ||
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      size > 64 * 1024 * 1024
    )
      throw new Error("Unexpected output size; preserve provider result.");
    const bytes = Buffer.from(await media.arrayBuffer());
    if (bytes.length > 64 * 1024 * 1024) throw new Error("Output too large.");
    c.durationMs = await probeMp4(
      async (o, n) => Uint8Array.from(bytes.subarray(o, o + n)).buffer,
      bytes.length,
    );
    c.file = `${dir}/text-clip-${journal.clips.length}.mp4`;
    writeFileSync(c.file, bytes);
    c.status = "stored";
    c.observedCompleteAt = new Date().toISOString();
    c.inferenceSeconds = out.timings?.inference;
    save();
    console.log(
      JSON.stringify({
        status: c.status,
        file: c.file,
        durationMs: c.durationMs,
        inferenceSeconds: c.inferenceSeconds,
      }),
    );
    process.exit(0);
  }
  const second = action === "--submit-second";
  if (!second && action !== "--submit-first")
    throw new Error("Choose submit-first, submit-second, or poll.");
  if (
    journal.clips.length !== (second ? 1 : 0) ||
    (second && journal.clips[0].status !== "stored")
  )
    throw new Error(
      "Stage already attempted or first clip incomplete; no automatic repetition.",
    );
  const reservedCents = 50; // Ten seconds at the regular $0.04/sec rate plus allowance, no image/video input.
  const total =
    originalExperimentCommitment() + lowCostReservations() + reservedCents;
  if (total > 500)
    throw new Error("This request exceeds the original US$5 experiment.");
  const identity =
    "An original ink-and-gouache animated interpretation of Sherlock Holmes from Arthur Conan Doyle's original literary stories. One adult male detective, about 40, tall and lean, a long narrow angular face, straight narrow nose, gray eyes, pale skin, clean-shaven, short straight black hair combed neatly back. He wears a charcoal-gray Victorian suit, cream high-collar shirt, dark burgundy cravat and a plain brown wool waistcoat. Original character design, no screen actor likeness, no modern screen adaptation. Muted amber and forest-green palette, hand-painted backgrounds, restrained 2D animation. Inside a Victorian London study at night: one wooden writing desk, green-shaded oil lamp, closed rain-streaked window behind the desk. No other people. No montage, no readable text overlays. Natural quiet British male voice, all dialogue in English. One continuous medium shot.";
  const prompt =
    identity +
    (second
      ? " The detective is standing beside the same described desk holding a small sealed cream envelope in his right hand. A quiet knock sounds from outside the room. He slowly turns his head toward the unseen door and says, 'We have a visitor.' He keeps the envelope in his right hand and ends listening. Only these simple actions in ten seconds."
      : " The detective stands beside the desk. He picks up a small sealed cream envelope with his right hand, examines the unmarked red wax seal and quietly says, 'This letter arrived too late.' He ends standing still beside the desk, holding the envelope in his right hand. Only these simple actions in ten seconds.");
  const c: Clip = {
    prompt,
    status: "attempted",
    reservedCents,
    attemptedAt: new Date().toISOString(),
  };
  journal.clips.push(c);
  save();
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
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok)
    throw new Error(
      `Submit HTTP ${response.status}; preserve attempted record and reconcile.`,
    );
  const receipt = (await response.json()) as {
    request_id: string;
    status_url: string;
    response_url: string;
  };
  trustedFalUrl(receipt.status_url, true);
  trustedFalUrl(receipt.response_url, true);
  if (!receipt.request_id) throw new Error("Receipt needs reconciliation.");
  Object.assign(c, {
    requestId: receipt.request_id,
    statusUrl: receipt.status_url,
    resultUrl: receipt.response_url,
    status: "submitted",
    submittedAt: new Date().toISOString(),
  });
  save();
  console.log(
    JSON.stringify({
      status: c.status,
      requestId: c.requestId,
      totalCommittedCents: total,
      budgetCents: 500,
    }),
  );
} catch (e) {
  console.error(
    e instanceof Error
      ? e.message.split(key).join("[redacted]")
      : "Experiment interrupted; reconcile before retrying.",
  );
  process.exitCode = 1;
}
