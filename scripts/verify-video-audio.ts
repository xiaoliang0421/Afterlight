// An opt-in check inside the SAME US$5 experiment, not an automatic publication gate.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  lockExperiment,
  audioReservations,
  lowCostReservations,
} from "./experiment-budget";
const index = Number(process.argv.at(-1));
if (
  !process.env.FAL_KEY ||
  !process.argv.includes("--authorized-5-usd") ||
  ![1, 2].includes(index)
)
  throw new Error(
    "Explicit experiment authorization and clip number 1 or 2 are required.",
  );
lockExperiment();
const dir = "artifacts/fal-smoke",
  journal = JSON.parse(readFileSync(`${dir}/journal.json`, "utf8"));
if (journal.clips[index - 1]?.status !== "stored")
  throw new Error("Store the requested clip first.");
const marker = `${dir}/audio-${index}.json`;
let reserved = journal.clips.reduce(
  (n: number, c: any) => n + c.reservedCents,
  0,
);
reserved += audioReservations() + lowCostReservations();
if (reserved + 10 > 500)
  throw new Error("The audio check would exceed the experiment budget.");
if (journal.clips[index - 1].durationMs > 15000)
  throw new Error("Unexpected audio duration.");
const audio = execFileSync(
  "ffmpeg",
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    `${dir}/clip-${index}.mp4`,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-f",
    "wav",
    "pipe:1",
  ],
  { maxBuffer: 2 * 1024 * 1024 },
);
writeFileSync(
  marker,
  JSON.stringify({
    status: "attempted",
    reservedCents: 10,
    model: "fal-ai/elevenlabs/speech-to-text/scribe-v2",
    at: new Date().toISOString(),
  }),
  { flag: "wx" },
);
// Published price: $0.008/input minute, no keyterms. Language is deliberately NOT forced to English.
try {
  const r = await fetch(
    "https://fal.run/fal-ai/elevenlabs/speech-to-text/scribe-v2",
    {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Key ${process.env.FAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        audio_url: `data:audio/wav;base64,${audio.toString("base64")}`,
        tag_audio_events: true,
        diarize: false,
      }),
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!r.ok)
    throw new Error(
      `Transcription HTTP ${r.status}; do not automatically repeat.`,
    );
  const result = (await r.json()) as {
    text: string;
    language_code: string;
    language_probability: number;
    words: unknown[];
  };
  writeFileSync(
    marker,
    JSON.stringify(
      { status: "completed", reservedCents: 10, result },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      clip: index,
      language: result.language_code,
      confidence: result.language_probability,
      text: result.text,
    }),
  );
} catch (e) {
  console.error(
    e instanceof Error
      ? e.message
      : "Audio check interrupted. Preserve its attempt record.",
  );
  process.exitCode = 1;
}
