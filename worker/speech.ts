import { Buffer } from "node:buffer";
import { z } from "zod";
import { assessSpeech } from "../shared/speech";
import { AppError } from "./errors";
import { ensureBudgetRows, getTask } from "./store";
import { trustedFalUrl } from "./media";

// Stream the JSON data URI with backpressure; never hold a complete video/base64 copy in Worker memory.
export function speechRequestBody(body: ReadableStream<Uint8Array>) {
  const encoder = new TextEncoder();
  async function* chunks() {
    const reader = body.getReader();
    let carry = Buffer.alloc(0);
    try {
      yield encoder.encode('{"audio_url":"data:video/mp4;base64,');
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const bytes = Buffer.concat([carry, value]);
        const end = bytes.length - (bytes.length % 3);
        for (let offset = 0; offset < end; offset += 48 * 1024)
          yield encoder.encode(
            bytes
              .subarray(offset, Math.min(end, offset + 48 * 1024))
              .toString("base64"),
          );
        carry = Buffer.from(bytes.subarray(end));
      }
      if (carry.length) yield encoder.encode(carry.toString("base64"));
      yield encoder.encode('","tag_audio_events":true,"diarize":false}');
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  }
  const iterator = chunks();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel() {
      await iterator.return();
    },
  });
}

export const SPEECH_MODEL = "fal-ai/elevenlabs/speech-to-text/scribe-v2";
interface SpeechRow {
  task_id: string;
  call_id: string;
  media_key: string;
  media_etag: string;
  duration_ms: number;
  status: string;
  request_id: string | null;
  status_url: string | null;
  result_url: string | null;
  result_json: string | null;
  failure_code: string;
  created_at: number;
  updated_at: number;
}
export const speechRow = (env: Cloudflare.Env, id: string) =>
  env.DB.prepare("SELECT * FROM speech_checks WHERE task_id=?")
    .bind(id)
    .first<SpeechRow>();
export async function speechDto(env: Cloudflare.Env, id: string) {
  const row = await speechRow(env, id);
  return row
    ? {
        status: row.status,
        requestId: row.request_id,
        failureCode: row.failure_code,
        result: row.result_json ? JSON.parse(row.result_json) : null,
        updatedAt: row.updated_at,
      }
    : null;
}
async function boundedJson(response: Response) {
  if (!response.ok || !response.body)
    throw new AppError(
      "speech_provider_unavailable",
      "Speech verification could not finish. Review the original clip; it will not be regenerated.",
      503,
    );
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 256 * 1024) {
      await reader.cancel();
      throw new Error("Speech result too large.");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function startSpeechCheck(env: Cloudflare.Env, id: string) {
  if (await speechRow(env, id)) return; // Any persisted attempt prevents another paid submission.
  if (!env.FAL_KEY || String(env.PROVIDER_MODE) !== "live")
    throw new AppError(
      "speech_unavailable",
      "Automatic speech checking is not connected. Review the original audio manually.",
      503,
    );
  const task = await getTask(env, id);
  if (
    task.source_kind === "upload" ||
    task.status !== "NeedsModeration" ||
    !task.media_ready ||
    !task.media_key ||
    !task.media_duration_ms
  )
    throw new AppError(
      "speech_task_changed",
      "This clip is not ready for speech review.",
      409,
    );
  const media = await env.MEDIA.get(task.media_key);
  if (!media || media.size > 32 * 1024 * 1024 || media.size <= 0) {
    if (media) await media.body.cancel();
    throw new AppError(
      "speech_media_size",
      "This clip requires manual speech review because its file is unavailable or exceeds the transcription size limit.",
      409,
    );
  }
  const { day, month } = await ensureBudgetRows(env, task.user_id);
  const now = Date.now();
  try {
    await env.DB.prepare(
      "INSERT INTO speech_checks(task_id,call_id,media_key,media_etag,duration_ms,day,month,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'submitting',?,?)",
    )
      .bind(
        id,
        crypto.randomUUID(),
        task.media_key,
        media.etag,
        task.media_duration_ms,
        day,
        month,
        now,
        now,
      )
      .run();
  } catch (error) {
    await media.body.cancel();
    throw error;
  }
  try {
    // No language hint: detection must be independent of the desired English output.
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      redirect: "manual",
      headers: {
        Authorization: `Key ${env.FAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: speechRequestBody(media.body),
      duplex: "half",
      signal: AbortSignal.timeout(45000),
    };
    const response = await fetch(`https://queue.fal.run/${SPEECH_MODEL}`, init);
    const result = z
      .object({
        request_id: z.string().uuid(),
        status_url: z.string().url(),
        response_url: z.string().url(),
      })
      .parse(await boundedJson(response));
    trustedFalUrl(result.status_url, true);
    trustedFalUrl(result.response_url, true);
    await env.DB.prepare(
      "UPDATE speech_checks SET status='queued',request_id=?,status_url=?,result_url=?,updated_at=? WHERE task_id=? AND status='submitting'",
    )
      .bind(
        result.request_id,
        result.status_url,
        result.response_url,
        Date.now(),
        id,
      )
      .run();
  } catch {
    await env.DB.prepare(
      "UPDATE speech_checks SET status='uncertain',failure_code='submission-uncertain',updated_at=? WHERE task_id=? AND status='submitting'",
    )
      .bind(Date.now(), id)
      .run();
  }
}
export async function refreshSpeechCheck(env: Cloudflare.Env, id: string) {
  const row = await speechRow(env, id);
  if (
    !row ||
    row.status !== "queued" ||
    !row.request_id ||
    !row.status_url ||
    !row.result_url ||
    !env.FAL_KEY
  )
    return;
  const request = (url: string) =>
    fetch(trustedFalUrl(url, true), {
      redirect: "manual",
      headers: { Authorization: `Key ${env.FAL_KEY}` },
      signal: AbortSignal.timeout(20000),
    });
  const status = z
    .object({ status: z.string(), error: z.unknown().optional() })
    .parse(await boundedJson(await request(row.status_url)));
  if (["IN_QUEUE", "IN_PROGRESS"].includes(status.status)) {
    await env.DB.prepare(
      "UPDATE speech_checks SET updated_at=? WHERE task_id=? AND status='queued'",
    )
      .bind(Date.now(), id)
      .run();
    return;
  }
  if (status.status !== "COMPLETED" || status.error) {
    await env.DB.prepare(
      "UPDATE speech_checks SET status='failed',failure_code='provider-review-required',updated_at=? WHERE task_id=? AND status='queued'",
    )
      .bind(Date.now(), id)
      .run();
    return;
  }
  const head = await env.MEDIA.head(row.media_key);
  if (!head || head.etag !== row.media_etag)
    throw new AppError(
      "speech_media_changed",
      "The video changed after speech verification started.",
      409,
    );
  const result = assessSpeech(
    await boundedJson(await request(row.result_url)),
    row.duration_ms,
  );
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE speech_checks SET status='completed',result_json=?,updated_at=? WHERE task_id=? AND status='queued'",
    ).bind(JSON.stringify(result), Date.now(), id),
    env.DB.prepare(
      "UPDATE model_calls SET status='completed',provider_model=? WHERE id=?",
    ).bind(SPEECH_MODEL, row.call_id),
  ]);
}
export async function reconcileSpeechChecks(env: Cloudflare.Env) {
  await env.DB.prepare(
    "UPDATE speech_checks SET status='uncertain',failure_code='submission-interrupted',updated_at=? WHERE status='submitting' AND created_at<?",
  )
    .bind(Date.now(), Date.now() - 120000)
    .run();
  const rows = await env.DB.prepare(
    "SELECT task_id FROM speech_checks WHERE status='queued' ORDER BY updated_at LIMIT 5",
  ).all<{ task_id: string }>();
  let failures = 0;
  for (const row of rows.results)
    try {
      await refreshSpeechCheck(env, row.task_id);
    } catch {
      failures++;
      console.error(
        JSON.stringify({ event: "speech.check-deferred", taskId: row.task_id }),
      );
    }
  if (failures) throw new Error("Speech result checks are incomplete.");
}
