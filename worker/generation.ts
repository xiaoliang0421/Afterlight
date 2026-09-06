import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { getStory, getTask, transition, audit } from "./store";
import { preparePlan } from "./director";
import { AppError } from "./errors";
import { pollVideo, submitVideo, prepareVideoRequest } from "./provider";
import { probeStoredMedia, storeProviderMedia } from "./media";
import type { ScenePlan } from "../shared/domain";
import { flagMajorChanges } from "../shared/governance";
import { hasOwnerApproval } from "./governance";

export class GenerationWorkflow extends WorkflowEntrypoint<
  Cloudflare.Env,
  { taskId: string; storyId: string; resumeKnown?: boolean }
> {
  async run(
    event: WorkflowEvent<{
      taskId: string;
      storyId: string;
      resumeKnown?: boolean;
    }>,
    step: WorkflowStep,
  ) {
    const { taskId, storyId } = event.payload;
    try {
      const prepared = await step.do(
        "recheck latest canon",
        { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" },
        async () => {
          const t = await getTask(this.env, taskId);
          if (
            event.payload.resumeKnown &&
            t.story_id === storyId &&
            t.status === "Generating" &&
            t.provider_request_id &&
            t.plan_json
          )
            return JSON.parse(t.plan_json) as ScenePlan;
          if (t.story_id !== storyId || t.status !== "Preparing") return null;
          const story = await getStory(this.env, storyId);
          const changed = story.version !== t.base_version;
          const { plan, baseVersion } =
            !changed && t.approved_plan_json
              ? {
                  plan: JSON.parse(t.approved_plan_json) as ScenePlan,
                  baseVersion: story.version,
                }
              : await preparePlan(this.env, t, true);
          if (plan.rejected) {
            await transition(
              this.env,
              taskId,
              ["Preparing"],
              "Failed",
              plan.reason,
            );
            return null;
          }
          flagMajorChanges(plan, t.prompt_original);
          await this.env.DB.prepare(
            "UPDATE tasks SET plan_json=?,base_version=?,updated_at=? WHERE id=? AND status='Preparing'",
          )
            .bind(JSON.stringify(plan), baseVersion, Date.now(), taskId)
            .run();
          if (changed && plan.requiresReview) {
            await transition(
              this.env,
              taskId,
              ["Preparing"],
              "NeedsReview",
              plan.reason,
            );
            return null;
          }
          if (
            !(await hasOwnerApproval(this.env, await getTask(this.env, taskId)))
          ) {
            await transition(
              this.env,
              taskId,
              ["Preparing"],
              "NeedsReview",
              "This plan contains a major story change. Request the story creator’s decision before rejoining. Any generation reservation has been returned.",
            );
            return null;
          }
          return plan;
        },
      );
      if (!prepared) return { status: "needs-review-or-stopped" };
      const plan: ScenePlan = prepared;
      if (
        String(this.env.PROVIDER_MODE) === "fixture" &&
        String(this.env.ENVIRONMENT) === "development"
      ) {
        await step.do("mark fixture playback test", async () => {
          await transition(this.env, taskId, ["Preparing"], "Generating");
        });
        await step.sleep("fixture pipeline delay", "2 seconds");
        await step.do(
          "prepare visibly labeled fixture for review",
          async () => {
            const t = await getTask(this.env, taskId);
            if (t.status !== "Generating") return;
            await this.env.DB.prepare(
              "UPDATE tasks SET status='NeedsModeration',media_key='fixture:sample',captions_key='fixture:captions',media_duration_ms=10000,media_ready=1,cost_status='fixture',reason='Development playback fixture. This is not an AI-generated fulfillment of the submitted idea.',updated_at=? WHERE id=? AND status='Generating'",
            )
              .bind(Date.now(), taskId)
              .run();
          },
        );
        return { status: "awaiting-fixture-review" };
      }
      await step.do(
        "submit video once",
        { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" },
        async () => {
          const t = await getTask(this.env, taskId);
          if (t.provider_request_id) return;
          if (t.provider_attempt_id)
            throw new AppError(
              "uncertain_submission",
              "A previous submit attempt must be reconciled.",
              409,
            );
          // Validate configuration and approved material before marking a possibly paid network attempt.
          const request = await prepareVideoRequest(this.env, t, plan);
          // The durable attempt marker precedes network I/O. A crash here never blindly resubmits.
          const claimed = await this.env.DB.prepare(
            "UPDATE tasks SET status='Generating',provider_attempt_id=?,updated_at=? WHERE id=? AND status='Preparing' AND provider_attempt_id IS NULL RETURNING id",
          )
            .bind(crypto.randomUUID(), Date.now(), taskId)
            .first();
          if (!claimed)
            throw new AppError(
              "task_changed",
              "The task is no longer ready to generate.",
              409,
            );
          const result = await submitVideo(this.env, request, t.provider_model);
          await this.env.DB.prepare(
            "UPDATE tasks SET provider_request_id=?,provider_status_url=?,provider_result_url=?,updated_at=? WHERE id=?",
          )
            .bind(
              result.request_id,
              result.status_url,
              result.response_url,
              Date.now(),
              taskId,
            )
            .run();
        },
      );
      let videoUrl: string | null = null;
      for (let i = 0; i < 90; i++) {
        const state = await step.do(
          `check provider ${i}`,
          {
            retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
          },
          async () => pollVideo(this.env, await getTask(this.env, taskId)),
        );
        if (state.status === "failed")
          throw new AppError(
            "generation_failed",
            "The video provider reported a failed result.",
            409,
          );
        if (state.status === "complete") {
          videoUrl = state.url;
          break;
        }
        await step.sleep(`wait for provider ${i}`, "20 seconds");
      }
      if (!videoUrl)
        throw new AppError(
          "provider_timeout",
          "The generation is taking longer than expected and needs reconciliation.",
          503,
        );
      const sourceUrl = videoUrl;
      await step.do(
        "archive original media",
        {
          retries: { limit: 3, delay: "10 seconds", backoff: "exponential" },
          timeout: "2 minutes",
        },
        async () => {
          const key = `stories/${storyId}/tasks/${taskId}/original.mp4`;
          await storeProviderMedia(this.env, sourceUrl, key);
          const duration = await probeStoredMedia(this.env, key);
          await this.env.DB.prepare(
            "UPDATE tasks SET status='NeedsModeration',media_key=?,media_duration_ms=?,media_ready=1,recorded_cost_cents=reserved_cents,cost_status='estimated-ceiling',reason='Review the actual video, English audio and text, continuity, and the events shown before publication.',updated_at=? WHERE id=? AND status IN ('Generating','Checking')",
          )
            .bind(key, duration, Date.now(), taskId)
            .run();
        },
      );
      return { status: "awaiting-content-review" };
    } catch (error) {
      await step.do("record recoverable failure", async () => {
        const task = await getTask(this.env, taskId);
        const uncertain = !!task.provider_attempt_id;
        const reason =
          error instanceof AppError
            ? error.message
            : "The task stopped unexpectedly and needs a studio review.";
        await transition(
          this.env,
          taskId,
          ["Preparing", "Generating", "Checking", "Packaging"],
          uncertain
            ? "ReconciliationNeeded"
            : error instanceof AppError &&
                [
                  "references_required",
                  "cost_review_required",
                  "owner_approval_required",
                ].includes(error.code)
              ? "NeedsReview"
              : "Failed",
          reason,
        );
        await audit(this.env, null, "generation.stopped", taskId, {
          uncertain,
          code: error instanceof AppError ? error.code : "unexpected",
        });
      });
      return { status: "stopped-for-review" };
    } finally {
      await step.do("notify and advance the story queue", async () => {
        await this.env.STORY_ROOMS.getByName(storyId).broadcast({
          type: "queue.updated",
          storyId,
          taskId,
        });
        await this.env.STORY_ROOMS.getByName(storyId).kick(storyId);
      });
    }
  }
}
