import { z } from "zod";
import { AppError } from "./errors";
import { getTask } from "./store";

export const videoCostInput = z.object({
  providerRequestId: z.string().trim().min(1).max(200),
  recordedCostCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  evidence: z.string().trim().min(10).max(600),
  reviewed: z.literal(true),
});
type Input = z.infer<typeof videoCostInput>;
const action = "video.cost-reconciled";

// The reservation remains held until moderation settles it through task_settle.
// A D1 batch records the receipt and cost together, even if moderation races us.
export async function reconcileVideoCost(
  env: Cloudflare.Env,
  taskId: string,
  actorId: string,
  input: Input,
) {
  const receiptId = `video-cost:${taskId}:${input.providerRequestId}`;
  const receipt = () =>
    env.DB.prepare(
      "SELECT detail FROM audit_log WHERE id=? AND action=? AND target_id=?",
    )
      .bind(receiptId, action, taskId)
      .first<{ detail: string }>();
  const confirm = (row: { detail: string }) => {
    const detail = JSON.parse(row.detail) as Input;
    if (
      detail.recordedCostCents !== input.recordedCostCents ||
      detail.providerRequestId !== input.providerRequestId
    )
      throw new AppError(
        "cost_already_reviewed",
        "A different cost was already recorded. Review the existing receipt before making a correction.",
        409,
      );
    return { ok: true, recordedCostCents: detail.recordedCostCents };
  };
  const existing = await receipt();
  if (existing) return confirm(existing);
  const task = await getTask(env, taskId);
  if (input.recordedCostCents > task.reserved_cents)
    throw new AppError(
      "cost_over_reservation",
      "The verified charge exceeds this reservation. Keep the task on hold and investigate the budget overrun before settlement.",
      409,
    );
  const eligible = `id=? AND provider_request_id=? AND status='NeedsModeration'
    AND media_ready=1 AND media_key IS NOT NULL AND media_key NOT LIKE 'fixture:%'
    AND reservation_active=1 AND cost_status='estimated-ceiling'
    AND reserved_cents>=? AND recorded_cost_cents=reserved_cents
    AND EXISTS(SELECT 1 FROM stories WHERE stories.id=tasks.story_id AND fixture=0)`;
  const guard = [taskId, input.providerRequestId, input.recordedCostCents];
  const now = Date.now();
  const detail = JSON.stringify({
    ...input,
    previousCostCents: task.recorded_cost_cents,
    reservedCents: task.reserved_cents,
    providerModel: task.provider_model,
  });
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO audit_log(id,actor_id,action,target_id,detail,created_at)
      SELECT ?,?,?,?,?,? FROM tasks WHERE ${eligible}
      ON CONFLICT(id) DO NOTHING`,
    ).bind(receiptId, actorId, action, taskId, detail, now, ...guard),
    env.DB.prepare(
      `UPDATE tasks SET recorded_cost_cents=?,cost_status='reconciled',updated_at=?
      WHERE ${eligible} AND EXISTS(SELECT 1 FROM audit_log WHERE id=? AND detail=?)`,
    ).bind(input.recordedCostCents, now, ...guard, receiptId, detail),
  ]);
  const saved = await receipt();
  if (!saved)
    throw new AppError(
      "cost_task_changed",
      "Only a completed real video awaiting moderation with its original active reservation can be reconciled. Refresh the task and verify its request ID.",
      409,
    );
  return confirm(saved);
}
