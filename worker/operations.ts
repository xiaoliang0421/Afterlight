import type { OperationName, OperationResult } from "../shared/operations";

async function recordedOperation(
  env: Cloudflare.Env,
  name: OperationName | "reconciliation",
  work: ((runId: string) => Promise<void>) | null,
  parentRunId: string | null = null,
) {
  const started = Date.now();
  const runId = crypto.randomUUID();
  const claimed = await env.DB.prepare(
    "INSERT INTO operation_health(name,started_at,run_id,status) SELECT ?,?,?,? WHERE ? IS NULL OR (SELECT run_id FROM operation_health WHERE name='reconciliation')=? ON CONFLICT(name) DO UPDATE SET started_at=excluded.started_at,run_id=excluded.run_id,status=excluded.status RETURNING name",
  )
    .bind(
      name,
      started,
      runId,
      work ? "running" : "skipped",
      parentRunId,
      parentRunId,
    )
    .first();
  if (!claimed || !work) return;
  try {
    await work(runId);
    await env.DB.prepare(
      "UPDATE operation_health SET completed_at=?,status='succeeded' WHERE name=? AND run_id=? AND (? IS NULL OR (SELECT run_id FROM operation_health WHERE name='reconciliation')=?)",
    )
      .bind(Date.now(), name, runId, parentRunId, parentRunId)
      .run();
  } catch (error) {
    await env.DB.prepare(
      "UPDATE operation_health SET failure_at=?,status='failed' WHERE name=? AND run_id=? AND (? IS NULL OR (SELECT run_id FROM operation_health WHERE name='reconciliation')=?)",
    )
      .bind(Date.now(), name, runId, parentRunId, parentRunId)
      .run();
    console.error(
      JSON.stringify({ event: "reconciliation.failed", operation: name }),
    );
    throw error;
  }
}

export function recordedReconciliation(
  env: Cloudflare.Env,
  work: (runId: string) => Promise<void>,
) {
  return recordedOperation(env, "reconciliation", work);
}

export async function runReconciliationSteps(
  env: Cloudflare.Env,
  steps: { name: OperationName; run: (() => Promise<void>) | null }[],
  parentRunId?: string,
) {
  // A failed dependency must not prevent unrelated queues or privacy cleanup from recovering.
  const failed: OperationName[] = [];
  for (const step of steps) {
    try {
      await recordedOperation(env, step.name, step.run, parentRunId);
    } catch {
      failed.push(step.name);
    }
  }
  if (failed.length)
    throw new Error(`Scheduled checks failed: ${failed.join(", ")}`);
}

export async function operationHealth(env: Cloudflare.Env) {
  const [runtime, queue, components] = await Promise.all([
    env.DB.prepare(
      "SELECT name,status,started_at AS startedAt,completed_at AS completedAt,failure_at AS failureAt FROM operation_health WHERE name='reconciliation'",
    ).first<OperationResult>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS held,COALESCE(SUM(CASE WHEN provider_request_id IS NULL THEN 1 ELSE 0 END),0) AS missingRequestIds,COALESCE(SUM(reserved_cents),0) AS reservedCents FROM tasks WHERE status='ReconciliationNeeded'",
    ).first<{
      held: number;
      missingRequestIds: number;
      reservedCents: number;
    }>(),
    env.DB.prepare(
      "SELECT name,status,started_at AS startedAt,completed_at AS completedAt,failure_at AS failureAt FROM operation_health WHERE name!='reconciliation' ORDER BY name",
    ).all<OperationResult>(),
  ]);
  return {
    runtime,
    queue,
    components: components.results,
    overdue:
      String(env.ENVIRONMENT) !== "development" &&
      (!runtime?.completedAt || runtime.completedAt < Date.now() - 15 * 60000),
  };
}
