import { z } from "zod";
import { AppError } from "./errors";
import { videoMode } from "./video-policy";
import type { TaskRow } from "./store";

const historySchema = z.object({
  items: z.array(
    z.object({
      request_id: z.string(),
      endpoint_id: z.string(),
      sent_at: z.string(),
      status_code: z.number().nullable(),
      json_input: z.unknown(),
    }),
  ),
});
// Provider-added defaults are allowed, but every submitted input must match.
export function matchesSubmitted(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((v, i) => matchesSubmitted(v, actual[i]))
    );
  if (expected !== null && typeof expected === "object")
    return (
      actual !== null &&
      typeof actual === "object" &&
      !Array.isArray(actual) &&
      Object.entries(expected).every(
        ([k, v]) =>
          Object.hasOwn(actual, k) &&
          matchesSubmitted(v, (actual as Record<string, unknown>)[k]),
      )
    );
  return expected === actual;
}
export async function requireStoppedWorkflow(
  env: Cloudflare.Env,
  task: TaskRow,
) {
  if (!task.workflow_id) return;
  try {
    const state = await (await env.GENERATION.get(task.workflow_id)).status();
    if (["complete", "errored", "terminated"].includes(state.status)) return;
  } catch {
    /* An unavailable runtime is not evidence that it stopped. */
  }
  throw new AppError(
    "workflow_active",
    "The previous workflow has not been confirmed stopped. Wait for its runtime to finish before reconciling.",
    409,
  );
}
export async function verifyRecoveredRequest(
  env: Cloudflare.Env,
  task: TaskRow,
  requestId: string,
) {
  if (!z.uuid().safeParse(requestId).success)
    throw new AppError("invalid_request", "Enter the fal request UUID.", 400);
  if (
    !task.provider_attempt_id ||
    !task.provider_input_json ||
    !task.provider_submitted_at
  )
    throw new AppError(
      "recovery_evidence_missing",
      "This older attempt has no saved input evidence. Keep it on hold and reconcile with provider support; it cannot be linked automatically.",
      409,
    );
  if (task.provider_request_id && task.provider_request_id !== requestId)
    throw new AppError(
      "request_already_linked",
      "This task is already linked to another request.",
      409,
    );
  videoMode(task.provider_model);
  const duplicate = await env.DB.prepare(
    "SELECT id FROM tasks WHERE provider_request_id=? AND id!=?",
  )
    .bind(requestId, task.id)
    .first();
  if (duplicate)
    throw new AppError(
      "request_already_linked",
      "This provider request already belongs to another task.",
      409,
    );
  const key = env.FAL_ADMIN_KEY ?? env.FAL_KEY;
  if (!key)
    throw new AppError(
      "provider_unavailable",
      "Configure the provider key before checking request history.",
      503,
    );
  const url = new URL("https://api.fal.ai/v1/models/requests/by-endpoint");
  url.search = new URLSearchParams({
    endpoint_id: task.provider_model,
    request_id: requestId,
    expand: "payloads",
    limit: "2",
  }).toString();
  const response = await fetch(url, {
    headers: { Authorization: `Key ${key}` },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new AppError(
      "provider_history_unavailable",
      response.status === 403
        ? "The fal key cannot read request history. Configure a key with the required history permissions."
        : "Provider history is unavailable. Keep the attempt on hold and try again later.",
      503,
    );
  const history = historySchema.safeParse(await response.json());
  const item =
    history.success && history.data.items.length === 1
      ? history.data.items[0]
      : null;
  const sent = item ? Date.parse(item.sent_at) : NaN;
  if (
    !item ||
    item.request_id !== requestId ||
    item.endpoint_id !== task.provider_model ||
    !Number.isFinite(sent) ||
    sent < task.provider_submitted_at - 5000 ||
    sent > task.provider_submitted_at + 60000 ||
    !matchesSubmitted(JSON.parse(task.provider_input_json), item.json_input)
  )
    throw new AppError(
      "request_mismatch",
      "The provider model, submission time and exact saved input could not all be matched. Nothing was linked or regenerated.",
      409,
    );
  // fal queue routes use the application ID (owner/application), without the inference subpath.
  const resultUrl = `https://queue.fal.run/${task.provider_model.split("/").slice(0, 2).join("/")}/requests/${requestId}`;
  const statusUrl = `${resultUrl}/status`;
  const statusResponse = await fetch(statusUrl, {
    headers: { Authorization: `Key ${env.FAL_KEY ?? key}` },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  const state = z
    .object({
      request_id: z.literal(requestId),
      status: z.enum(["IN_QUEUE", "IN_PROGRESS", "COMPLETED"]),
    })
    .safeParse(statusResponse.ok ? await statusResponse.json() : null);
  if (!state.success)
    throw new AppError(
      "provider_status_unavailable",
      "The matching request exists, but its queue status is unavailable. Leave it on hold until status can be verified.",
      409,
    );
  return {
    requestId,
    model: item.endpoint_id,
    sentAt: item.sent_at,
    status: state.data.status,
    statusUrl,
    resultUrl,
  };
}

export async function scheduleRecovery(
  env: Cloudflare.Env,
  task: TaskRow,
  reason: string,
) {
  if (
    !task.provider_request_id ||
    !task.provider_status_url ||
    !task.provider_result_url
  )
    throw new AppError(
      "request_missing",
      "Verify and link the existing provider request before resuming.",
      409,
    );
  const workflowId = `recovery-${task.id}-${crypto.randomUUID().slice(0, 8)}`;
  const changed = await env.DB.prepare(
    "UPDATE tasks SET status='Generating',workflow_id=?,reason=?,updated_at=? WHERE id=? AND status='ReconciliationNeeded' AND workflow_id IS ? RETURNING id",
  )
    .bind(workflowId, reason, Date.now(), task.id, task.workflow_id)
    .first();
  if (!changed)
    throw new AppError(
      "task_changed",
      "Another operator already handled this task. Refresh its status.",
      409,
    );
  // D1 is the durable dispatch record. StoryRoom and the scheduled reconciler retry this same workflow ID.
  return workflowId;
}
