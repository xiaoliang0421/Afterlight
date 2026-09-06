import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { buildArchive } from "./archives";
export class ArchiveWorkflow extends WorkflowEntrypoint<
  Cloudflare.Env,
  { archiveId: string }
> {
  async run(event: WorkflowEvent<{ archiveId: string }>, step: WorkflowStep) {
    await step.do(
      "prepare story archive once",
      { retries: { limit: 0, delay: "1 second" }, timeout: "1 minute" },
      () => buildArchive(this.env, event.payload.archiveId),
    );
    return { archiveId: event.payload.archiveId };
  }
}
