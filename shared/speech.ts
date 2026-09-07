import { z } from "zod";

export const speechResultSchema = z.object({
  text: z.string().max(12000),
  language_code: z.string().max(12),
  language_probability: z.number().min(0).max(1),
  words: z
    .array(
      z.object({
        text: z.string().max(1000),
        type: z.enum(["word", "spacing", "audio_event"]),
        start: z.number().finite().nonnegative().nullish(),
        end: z.number().finite().nonnegative().nullish(),
      }),
    )
    .max(2000),
});
export type SpeechAssessment = {
  language: string;
  confidence: number;
  transcript: string;
  verdict: "english-likely" | "review-required";
  issues: string[];
  captions: string;
};
const timestamp = (ms: number) => {
  const n = Math.round(ms);
  return `${String(Math.floor(n / 3600000)).padStart(2, "0")}:${String(Math.floor(n / 60000) % 60).padStart(2, "0")}:${String(Math.floor(n / 1000) % 60).padStart(2, "0")}.${String(n % 1000).padStart(3, "0")}`;
};
const captionText = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\r\n\u0000-\u001f]/g, " ");
export function assessSpeech(
  raw: unknown,
  durationMs: number,
): SpeechAssessment {
  const data = speechResultSchema.parse(raw);
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs <= 0 ||
    durationMs > 20000
  )
    throw new Error("Invalid clip duration.");
  const issues: string[] = [];
  const spoken = data.words.filter((w) => w.type === "word");
  if (!spoken.length)
    issues.push(
      "No speech was detected. Listen before confirming that this clip has no dialogue or narration.",
    );
  if (!["en", "eng"].includes(data.language_code.toLowerCase()))
    issues.push("Speech was not identified as English.");
  if (data.language_probability < 0.8)
    issues.push("Language confidence is low.");
  // A high English score cannot validate mixed-language passages or text shown in the video.
  if (
    /[^\p{Script=Latin}\p{M}\p{N}\p{P}\p{Z}\p{S}\s]/u.test(
      spoken.map((w) => w.text).join(" "),
    )
  )
    issues.push(
      "The transcript contains writing outside the Latin alphabet. Review possible mixed-language speech.",
    );
  let previousEnd = 0;
  let valid = true;
  const timed = spoken.flatMap((w) => {
    if (
      w.start == null ||
      w.end == null ||
      w.start * 1000 < previousEnd - 50 ||
      w.end <= w.start ||
      w.end * 1000 > durationMs + 150
    ) {
      valid = false;
      return [];
    }
    const start = Math.max(previousEnd, Math.round(w.start * 1000));
    const end = Math.min(durationMs, Math.round(w.end * 1000));
    previousEnd = end;
    if (end <= start) {
      valid = false;
      return [];
    }
    return [{ text: w.text, start, end }];
  });
  if (!valid)
    issues.push(
      "Transcript timing needs correction; no caption draft was produced.",
    );
  const cues: { text: string; start: number; end: number }[] = [];
  if (valid)
    for (const word of timed) {
      const last = cues.at(-1);
      if (
        last &&
        word.end - last.start <= 3200 &&
        last.text.length + word.text.length < 76 &&
        word.start - last.end < 700
      ) {
        last.text += ` ${word.text}`;
        last.end = word.end;
      } else cues.push({ ...word });
    }
  return {
    language: data.language_code,
    confidence: data.language_probability,
    transcript: data.text,
    verdict: issues.length ? "review-required" : "english-likely",
    issues,
    captions:
      "WEBVTT\n\n" +
      cues
        .map(
          (c) =>
            `${timestamp(c.start)} --> ${timestamp(c.end)}\n${captionText(c.text)}\n`,
        )
        .join("\n"),
  };
}
