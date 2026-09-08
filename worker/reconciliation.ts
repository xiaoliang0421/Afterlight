import { cleanupUploads } from "./production";
import { reconcilePayments } from "./billing";
import { cleanupDeletedAccountMedia } from "./account-deletion";
import { reconcileSpeechChecks } from "./speech";
import { refreshBalance } from "./admin";
import { dispatchArchives } from "./archives";
import { runReconciliationSteps } from "./operations";

async function recoverQueues(env: Cloudflare.Env) {
  const stories = (
    await env.DB.prepare(
      "SELECT id FROM stories WHERE active_task_id IS NOT NULL OR (status='open' AND EXISTS(SELECT 1 FROM tasks WHERE story_id=stories.id AND status='Queued')) LIMIT 100",
    ).all<{ id: string }>()
  ).results;
  let failures = 0;
  for (const story of stories) {
    try {
      await env.STORY_ROOMS.getByName(story.id).kick(story.id);
    } catch {
      failures++;
      console.error(
        JSON.stringify({ event: "queue.recovery-failed", storyId: story.id }),
      );
    }
  }
  if (failures) throw new Error("Story queue recovery is incomplete.");
}

async function sendOutbox(env: Cloudflare.Env) {
  const outbox = (
    await env.DB.prepare(
      "SELECT id,story_id FROM outbox WHERE sent_at IS NULL ORDER BY created_at LIMIT 100",
    ).all<{ id: string; story_id: string }>()
  ).results;
  let failures = 0;
  for (const event of outbox) {
    try {
      await env.STORY_ROOMS.getByName(event.story_id).broadcast({
        type: "story.updated",
        storyId: event.story_id,
      });
      await env.DB.prepare(
        "UPDATE outbox SET sent_at=? WHERE id=? AND sent_at IS NULL",
      )
        .bind(Date.now(), event.id)
        .run();
    } catch {
      failures++;
      console.error(
        JSON.stringify({ event: "outbox.delivery-failed", eventId: event.id }),
      );
    }
  }
  if (failures) throw new Error("Story update delivery is incomplete.");
}

export async function reconcile(env: Cloudflare.Env, runId?: string) {
  await runReconciliationSteps(
    env,
    [
      {
        name: "payments",
        run: env.PADDLE_API_KEY ? () => reconcilePayments(env) : null,
      },
      { name: "privacy-media", run: () => cleanupDeletedAccountMedia(env) },
      { name: "speech", run: () => reconcileSpeechChecks(env) },
      {
        name: "provider-balance",
        run:
          String(env.PROVIDER_MODE) === "live"
            ? async () => {
                await refreshBalance(env);
              }
            : null,
      },
      { name: "story-queues", run: () => recoverQueues(env) },
      { name: "archives", run: () => dispatchArchives(env) },
      { name: "outbox", run: () => sendOutbox(env) },
      {
        name: "housekeeping",
        run: async () => {
          await cleanupUploads(env);
          await env.DB.batch([
            env.DB.prepare("DELETE FROM rate_limits WHERE expires_at<?").bind(
              Date.now(),
            ),
            env.DB.prepare("DELETE FROM sessions WHERE expires_at<?").bind(
              Date.now(),
            ),
          ]);
        },
      },
    ],
    runId,
  );
}
