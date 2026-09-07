export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 503 = 400,
  ) {
    super(message);
  }
}
export const errorMessages: Record<string, string> = {
  account_deleted:
    "This account has been deleted. Sign in again to start a new account.",
  owner_approval_required:
    "This plan needs the story creator’s approval before it can enter generation.",
  owner_review_changed:
    "The story or plan changed. Prepare a fresh preview before requesting a decision.",
  owner_review_pending:
    "You already have a proposal waiting for this story creator. Withdraw it before requesting another.",
  owner_review_full:
    "This story has too many pending decisions. Your idea is saved; try again later.",
  reference_unavailable:
    "Reference-guided creation is not open yet. Free text-to-video remains available.",
  paid_credits_unavailable:
    "There are not enough available purchased points, or your payment needs review.",
  "payment_orders.user_id":
    "You already have an unfinished checkout. Check its status in your account before starting another.",
  generation_paused:
    "New creations are paused. Your idea is saved, and you can keep watching.",
  story_paused: "This story is not accepting new scenes right now.",
  plan_required: "Review a scene plan before joining the queue.",
  payment_disabled:
    "Purchases are not available. There is no charge to your account.",
  already_in_queue: "You already have a scene in this story’s queue.",
  queue_full: "This story’s queue is full. Your idea is saved for later.",
  credits_exhausted:
    "You have used today’s creation credits. Check your account for the reset time.",
  capacity_full:
    "Today’s creation capacity is full. Your idea is saved for later.",
  balance_stale:
    "Creation capacity is being checked. Your idea is saved for later.",
  provider_capacity:
    "Creation capacity is temporarily full. You can keep watching.",
  story_version_conflict:
    "The story has moved forward. This scene needs another continuity review.",
  media_not_approved:
    "The video must be saved, playable and reviewed before it can be published.",
  reservation_required: "This task has no active budget reservation.",
  "users.nickname_key":
    "This public nickname is already in use. Please choose another.",
};
export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const detail =
    error instanceof Error
      ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}`
      : "";
  for (const [code, message] of Object.entries(errorMessages))
    if (detail.includes(code)) return new AppError(code, message, 409);
  return new AppError(
    "internal_error",
    "Something went wrong. Please try again; your saved work is safe.",
    500,
  );
}
