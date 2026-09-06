import { AppError } from "./errors";

// Lower bound from fal's H3 Max reference-to-video price sheet, reviewed 2026-09-06.
// Image dimensions are not verified by the current material importer, so this is
// deliberately NOT presented as a complete quote or guaranteed spending ceiling.
// Release acceptance must also validate every image/voice input and the current rate.
export function h3KnownCostFloorCents(input: {
  outputSeconds: number;
  previousVideoMs: number;
  voiceMs: number;
}) {
  for (const value of Object.values(input)) {
    if (!Number.isFinite(value) || value < 0)
      throw new AppError(
        "invalid_cost_input",
        "Video inputs need studio review.",
        409,
      );
  }
  // 768P: 74,592 tokens for ten seconds of reference video; audio ~80 tokens/sec.
  const tokens =
    (input.previousVideoMs / 1000) * 7459.2 + (input.voiceMs / 1000) * 80;
  return Math.ceil(
    input.outputSeconds * 8 + Math.max(0, tokens - 4096) * 0.002,
  );
}

export function assertVideoReservation(
  reservedCents: number,
  input: Parameters<typeof h3KnownCostFloorCents>[0],
) {
  if (
    !Number.isSafeInteger(reservedCents) ||
    reservedCents < h3KnownCostFloorCents(input)
  )
    throw new AppError(
      "cost_review_required",
      "The studio needs to review this scene’s generation capacity. Your idea is saved and no video request has been sent.",
      409,
    );
}
