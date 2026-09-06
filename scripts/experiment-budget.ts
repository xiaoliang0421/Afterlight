import {
  mkdirSync,
  writeFileSync,
  unlinkSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { resolve } from "node:path";

// Shared by the explicitly authorized video and audio experiments. A crash leaves
// the attempt ledger intact; a stale lock requires inspection, never paid retry.
export function lockExperiment() {
  const dir = resolve("artifacts/fal-smoke");
  mkdirSync(dir, { recursive: true });
  const lock = resolve(dir, ".experiment.lock");
  try {
    writeFileSync(
      lock,
      JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
      { flag: "wx", mode: 0o600 },
    );
  } catch {
    throw new Error(
      "The experiment is locked. Inspect the running process and attempt ledger before clearing a stale lock.",
    );
  }
  process.once("exit", () => {
    try {
      unlinkSync(lock);
    } catch {
      /* Already released. */
    }
  });
  process.once("SIGINT", () => process.exit(130));
  process.once("SIGTERM", () => process.exit(143));
}

export function audioReservations() {
  let total = 0;
  for (const i of [1, 2]) {
    const file = resolve(`artifacts/fal-smoke/audio-${i}.json`);
    if (existsSync(file)) {
      const entry = JSON.parse(readFileSync(file, "utf8"));
      if (
        !Number.isSafeInteger(entry.reservedCents) ||
        entry.reservedCents < 10
      )
        throw new Error("The audio budget ledger needs reconciliation.");
      total += entry.reservedCents;
    }
  }
  return total;
}

export function lowCostReservations() {
  const file = resolve("artifacts/fal-smoke/low-cost.json");
  if (!existsSync(file)) return 0;
  const entries = JSON.parse(readFileSync(file, "utf8")).clips;
  if (!Array.isArray(entries))
    throw new Error("Inspect the low-cost experiment ledger.");
  return entries.reduce((sum: number, entry: { reservedCents: number }) => {
    if (!Number.isSafeInteger(entry.reservedCents) || entry.reservedCents < 25)
      throw new Error("Inspect the low-cost experiment reservation.");
    return sum + entry.reservedCents;
  }, 0);
}

export function videoReservations() {
  const file = resolve("artifacts/fal-smoke/journal.json");
  if (!existsSync(file))
    throw new Error(
      "The original experiment ledger is required. Do not reset the authorization.",
    );
  const entries = JSON.parse(readFileSync(file, "utf8")).clips;
  if (!Array.isArray(entries))
    throw new Error("Inspect the original experiment ledger.");
  return entries.reduce((sum: number, entry: { reservedCents: number }) => {
    if (!Number.isSafeInteger(entry.reservedCents) || entry.reservedCents < 0)
      throw new Error("Inspect the original experiment reservation.");
    return sum + entry.reservedCents;
  }, 0);
}

export function originalExperimentCommitment() {
  const ledger = resolve("artifacts/fal-smoke/billing-confirmation.json");
  const fallback = videoReservations() + audioReservations();
  if (!existsSync(ledger)) return fallback;
  const invoice = JSON.parse(readFileSync(ledger, "utf8"));
  const videos = JSON.parse(
    readFileSync(resolve("artifacts/fal-smoke/journal.json"), "utf8"),
  ).clips;
  const ids = videos.map((c: { requestId: string }) => c.requestId);
  if (
    invoice.source !== "User-provided provider billing totals" ||
    JSON.stringify(ids) !== JSON.stringify(invoice.videoRequestIds) ||
    invoice.completedSpeechChecks !== 2
  )
    throw new Error(
      "The confirmed invoice does not cover the current original requests.",
    );
  for (const i of [1, 2])
    if (
      JSON.parse(
        readFileSync(resolve(`artifacts/fal-smoke/audio-${i}.json`), "utf8"),
      ).status !== "completed"
    )
      throw new Error("The confirmed speech checks are not complete.");
  for (const cost of [invoice.videoCents, invoice.speechCents])
    if (!Number.isSafeInteger(cost) || cost < 0)
      throw new Error("Invalid confirmed cost.");
  return invoice.videoCents + invoice.speechCents;
}
