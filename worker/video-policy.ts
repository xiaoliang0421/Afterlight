import { AppError } from "./errors";

export function videoMode(model: string) {
  if (model === "minimax/h3-max-turbo/text-to-video") return "text" as const;
  if (model === "minimax/h3-max/reference-to-video")
    return "reference" as const;
  throw new AppError(
    "model_cost_review_required",
    "The selected video model needs a reviewed cost and input adapter.",
    503,
  );
}

// Use the announced REGULAR rate, not the launch discount ending September 7.
// Reviewed 2026-09-06: Turbo 768P text-only output $0.04 / requested second.
export function assertTextVideoReservation(
  reservedCents: number,
  seconds: number,
) {
  if (
    !Number.isSafeInteger(seconds) ||
    seconds < 5 ||
    seconds > 15 ||
    !Number.isSafeInteger(reservedCents) ||
    reservedCents < seconds * 4
  )
    throw new AppError(
      "cost_review_required",
      "The studio needs to review this scene’s generation capacity before a video request is sent.",
      409,
    );
}
