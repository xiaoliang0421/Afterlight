import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";

test(
  "native Workflow and StoryRoom resume durable dispatch and archive the existing request without any provider POST",
  { timeout: 45000 },
  async (t) => {
    const bundle = await build({
      stdin: {
        contents: `export { GenerationWorkflow } from './worker/generation.ts';
        export { StoryRoom } from './worker/story-room.ts';
        import { getTask } from './worker/store.ts';
        import { requireStoppedWorkflow, scheduleRecovery } from './worker/recovery.ts';
        import { reconcile } from './worker/reconciliation.ts';
        import { recordedReconciliation } from './worker/operations.ts';
        export default { async fetch(request, env) {
          const task = await getTask(env, 'runtime-recovery');
          const path = new URL(request.url).pathname;
          if (path === '/old') {
            await env.GENERATION.create({ id: 'old-runtime', params: { taskId: task.id, storyId: task.story_id } });
          } else if (path === '/schedule') {
            if (task.status !== 'ReconciliationNeeded') return new Response('Task changed', { status: 409 });
            await requireStoppedWorkflow(env, task);
            await scheduleRecovery(env, task, 'Synthetic provider evidence was verified.');
            // Deliberately omit the wake-up to reproduce a dispatch interruption.
          } else if (path === '/tick') {
            await recordedReconciliation(env, (runId) => reconcile(env, runId));
          }
          const latest = await getTask(env, task.id);
          let runtime = null;
          try { runtime = await (await env.GENERATION.get(latest.workflow_id)).status(); } catch {}
          return Response.json({ task: latest, runtime });
        }};`,
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      conditions: ["workerd", "worker", "browser"],
      external: ["cloudflare:*", "node:*"],
    });
    const clip = readFileSync("public/samples/playback.mp4");
    const requestId = "00000000-0000-4000-8000-000000000123";
    const resultUrl = `https://queue.fal.run/minimax/h3-max-turbo/requests/${requestId}`;
    const requests: string[] = [];
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        compatibilityDate: "2026-09-06",
        compatibilityFlags: ["nodejs_compat"],
        script: bundle.outputFiles[0].text,
        d1Databases: ["DB"],
        r2Buckets: ["MEDIA"],
        durableObjects: {
          STORY_ROOMS: { className: "StoryRoom", useSQLite: true },
        },
        workflows: {
          GENERATION: {
            name: "recovery-test",
            className: "GenerationWorkflow",
          },
        },
        bindings: {
          ENVIRONMENT: "development",
          PROVIDER_MODE: "disabled",
          FAL_KEY: "synthetic-not-a-real-key",
        },
        outboundService: async (request) => {
          requests.push(`${request.method} ${request.url}`);
          assert.equal(
            request.method,
            "GET",
            "Recovery must not submit any paid request",
          );
          if (request.url === `${resultUrl}/status`)
            return Response.json({
              request_id: requestId,
              status: "COMPLETED",
            });
          if (request.url === resultUrl)
            return Response.json({
              video: { url: "https://fal.media/synthetic-recovered.mp4" },
            });
          assert.equal(
            request.url,
            "https://fal.media/synthetic-recovered.mp4",
          );
          return new Response(clip, {
            headers: {
              "Content-Type": "video/mp4",
              "Content-Length": String(clip.length),
            },
          });
        },
      }),
    );
    t.after(() => runtime.dispose());
    const db = await runtime.getD1Database("DB");
    for (const source of [
      ...readdirSync("migrations")
        .sort()
        .map((file) => readFileSync(`migrations/${file}`, "utf8")),
      readFileSync("fixtures/seed.sql", "utf8"),
    ])
      await db.batch(
        unstable_splitSqlQuery(source).map((sql) => db.prepare(sql)),
      );
    await db
      .prepare(
        `INSERT INTO tasks(id,story_id,user_id,prompt_original,plan_json,base_version,idempotency_key,
    created_at,updated_at,status,provider_attempt_id,provider_request_id,provider_input_json,provider_submitted_at,
    provider_model,provider_status_url,provider_result_url,workflow_id,reserved_cents,reservation_active)
    VALUES('runtime-recovery','last-light','dev-creator','Synthetic recovery test','{}',3,'runtime-recovery',1,1,
    'ReconciliationNeeded','original-attempt',?,'{}',1,'minimax/h3-max-turbo/text-to-video',?,?,'old-runtime',10,1)`,
      )
      .bind(requestId, `${resultUrl}/status`, resultUrl)
      .run();
    await db
      .prepare(
        "UPDATE stories SET active_task_id='runtime-recovery' WHERE id='last-light'",
      )
      .run();
    const get = async (path = "/state") => {
      const response = await runtime.dispatchFetch(
        `https://test.invalid${path}`,
      );
      assert.equal(response.status, 200, await response.clone().text());
      return response.json() as Promise<{
        task: Record<string, any>;
        runtime: { status: string } | null;
      }>;
    };
    const until = async (
      check: (state: Awaited<ReturnType<typeof get>>) => boolean,
    ) => {
      const deadline = Date.now() + 20000;
      let state = await get();
      while (!check(state) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        state = await get();
      }
      assert.ok(check(state), JSON.stringify(state));
      return state;
    };
    await get("/old");
    await until((state) => state.runtime?.status === "complete");
    const scheduled = await get("/schedule");
    assert.equal(scheduled.task.status, "Generating");
    assert.match(scheduled.task.workflow_id, /^recovery-runtime-recovery-/);
    assert.equal(scheduled.runtime, null);
    await get("/tick");
    const finished = await until(
      (state) =>
        state.task.status === "NeedsModeration" &&
        state.runtime?.status === "complete",
    );
    assert.equal(finished.task.workflow_id, scheduled.task.workflow_id);
    assert.equal(finished.task.provider_request_id, requestId);
    assert.equal(finished.task.provider_attempt_id, "original-attempt");
    assert.equal(finished.task.reserved_cents, 10);
    assert.equal(finished.task.reservation_active, 1);
    assert.equal(finished.task.media_ready, 1);
    const media = await (
      await runtime.getR2Bucket("MEDIA")
    ).get(finished.task.media_key);
    assert.ok(media);
    assert.deepEqual(Buffer.from(await media.arrayBuffer()), clip);
    assert.equal(
      (await db.prepare("SELECT COUNT(*) AS n FROM scenes").first())!.n,
      4,
    );
    assert.equal(
      (await db.prepare("SELECT COUNT(*) AS n FROM model_calls").first())!.n,
      0,
    );
    assert.equal(
      (await runtime.dispatchFetch("https://test.invalid/schedule")).status,
      409,
    );
    await get("/tick");
    assert.deepEqual(requests, [
      `GET ${resultUrl}/status`,
      `GET ${resultUrl}`,
      "GET https://fal.media/synthetic-recovered.mp4",
    ]);
  },
);
