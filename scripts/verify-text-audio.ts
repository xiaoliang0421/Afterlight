// Opt-in real test of the SAME Worker implementation, using saved text-video originals.
// Fake D1/R2 bindings are isolated and durable; no website or public canon is mutated.
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { adaptD1, migrateFixture } from "../tests/support/database";
import {
  startSpeechCheck,
  refreshSpeechCheck,
  speechDto,
} from "../worker/speech";
import {
  lockExperiment,
  originalExperimentCommitment,
  lowCostReservations,
} from "./experiment-budget";
const index = Number(process.argv.at(-1));
if (
  !process.env.FAL_KEY ||
  !process.argv.includes("--authorized-total-10-usd") ||
  ![1, 2].includes(index)
)
  throw new Error(
    "The dated US$10 cumulative authorization and a saved text clip (1 or 2) are required.",
  );
lockExperiment();
const dir = "artifacts/fal-smoke",
  marker = `${dir}/text-audio-${index}.json`,
  dbPath = `${dir}/text-audio-${index}.sqlite`;
const video = readFileSync(`${dir}/text-clip-${index}.mp4`);
if (video.byteLength > 32 * 1024 * 1024)
  throw new Error("Input exceeds the Worker transcription limit.");
const hash = createHash("sha256").update(video).digest("hex");
const clip = JSON.parse(readFileSync(`${dir}/low-cost.json`, "utf8")).clips[
  index - 1
];
if (!clip || clip.status !== "stored" || clip.durationMs > 20000)
  throw new Error("Store and verify the original text video first.");
let journal: any;
if (existsSync(marker)) {
  journal = JSON.parse(readFileSync(marker, "utf8"));
  if (
    journal.sha256 !== hash ||
    journal.reservedCents !== 10 ||
    !existsSync(dbPath)
  )
    throw new Error("Inspect the existing attempt before continuing.");
  if (journal.status === "completed") {
    console.log(
      JSON.stringify({
        alreadyCompleted: true,
        clip: index,
        assessment: journal.assessment,
      }),
    );
    process.exit(0);
  }
} else {
  if (existsSync(dbPath))
    throw new Error("An interrupted database initialization needs inspection.");
  if (originalExperimentCommitment() + lowCostReservations() + 10 > 1000)
    throw new Error("The cumulative experiment ceiling would be exceeded.");
  journal = {
    authorization: "2026-09-07: cumulative US$10; text video and speech only",
    sha256: hash,
    reservedCents: 10,
    status: "prepared",
    at: new Date().toISOString(),
  };
}
const fresh = !existsSync(dbPath);
const db = new DatabaseSync(dbPath);
chmodSync(dbPath, 0o600);
if (fresh) {
  migrateFixture(db);
  db.prepare(
    "INSERT INTO tasks(id,story_id,user_id,prompt_original,base_version,idempotency_key,created_at,updated_at,status,media_key,media_duration_ms,media_ready) VALUES('speech-live','last-light','dev-creator','Isolated original literary character test',3,'speech-live',1,1,'NeedsModeration','stories/last-light/tasks/speech-live/original.mp4',?,1)",
  ).run(clip.durationMs);
  writeFileSync(marker, JSON.stringify(journal, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
}
const media = {
  size: video.byteLength,
  etag: hash,
  async arrayBuffer() {
    return video.buffer.slice(
      video.byteOffset,
      video.byteOffset + video.byteLength,
    );
  },
};
const env = {
  DB: adaptD1(db),
  MEDIA: {
    async get() {
      return { ...media, body: new Blob([video]).stream() };
    },
    async head() {
      return media;
    },
  },
  PROVIDER_MODE: "live",
  FAL_KEY: process.env.FAL_KEY,
} as unknown as Cloudflare.Env;
await startSpeechCheck(env, "speech-live");
let check = await speechDto(env, "speech-live");
if (check?.status === "queued") {
  for (let i = 0; i < 12; i++) {
    await refreshSpeechCheck(env, "speech-live");
    check = await speechDto(env, "speech-live");
    if (check?.status !== "queued") break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
journal = {
  ...journal,
  status: check?.status ?? "inspect-required",
  requestId: check?.requestId ?? null,
  assessment: check?.result ?? null,
  updatedAt: new Date().toISOString(),
};
writeFileSync(marker, JSON.stringify(journal, null, 2) + "\n", { mode: 0o600 });
console.log(
  JSON.stringify(
    {
      clip: index,
      status: journal.status,
      reservedCents: 10,
      cumulativeCommitmentCents:
        originalExperimentCommitment() + lowCostReservations(),
      assessment: journal.assessment,
    },
    null,
    2,
  ),
);
db.close();
