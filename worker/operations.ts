export async function recordedReconciliation(
  env: Cloudflare.Env,
  work: () => Promise<void>,
) {
  const started = Date.now();
  await env.DB.prepare(
    "UPDATE operation_health SET started_at=? WHERE name='reconciliation'",
  )
    .bind(started)
    .run();
  try {
    await work();
    await env.DB.prepare(
      "UPDATE operation_health SET completed_at=? WHERE name='reconciliation' AND started_at=?",
    )
      .bind(Date.now(), started)
      .run();
  } catch (error) {
    await env.DB.prepare(
      "UPDATE operation_health SET failure_at=? WHERE name='reconciliation' AND started_at=?",
    )
      .bind(Date.now(), started)
      .run();
    console.error(JSON.stringify({ event: "reconciliation.failed" }));
    throw error;
  }
}
export async function operationHealth(env: Cloudflare.Env) {
  const [runtime, queue] = await Promise.all([
    env.DB.prepare(
      "SELECT started_at AS startedAt,completed_at AS completedAt,failure_at AS failureAt FROM operation_health WHERE name='reconciliation'",
    ).first<{ startedAt: number; completedAt: number; failureAt: number }>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS held,COALESCE(SUM(CASE WHEN provider_request_id IS NULL THEN 1 ELSE 0 END),0) AS missingRequestIds,COALESCE(SUM(reserved_cents),0) AS reservedCents FROM tasks WHERE status='ReconciliationNeeded'",
    ).first<{
      held: number;
      missingRequestIds: number;
      reservedCents: number;
    }>(),
  ]);
  return {
    runtime,
    queue,
    overdue:
      String(env.ENVIRONMENT) !== "development" &&
      (!runtime?.completedAt || runtime.completedAt < Date.now() - 15 * 60000),
  };
}
