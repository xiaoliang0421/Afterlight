import { DurableObject } from "cloudflare:workers";
import { audit, transition } from "./store";

export class StoryRoom extends DurableObject<Cloudflare.Env> {
  async fetch(request: Request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response("WebSocket required", { status: 426 });
    return this.subscribe(new URL(request.url).searchParams.get("storyId")!);
  }
  async subscribe(storyId: string) {
    await this.ctx.storage.put("storyId", storyId);
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].send(JSON.stringify({ type: "connected", storyId }));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async broadcast(message: {
    type: string;
    storyId: string;
    taskId?: string;
    sceneId?: string;
  }) {
    const text = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(text);
      } catch {
        socket.close(1011, "Reconnect to refresh the story.");
      }
    }
  }
  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (message === "ping") socket.send("pong");
  }
  webSocketClose(socket: WebSocket, code: number, reason: string) {
    // Browsers may report reserved no-status codes such as 1005; these cannot be sent.
    const valid =
      [
        1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014,
      ].includes(code) ||
      (code >= 3000 && code <= 4999);
    socket.close(valid ? code : 1000, valid ? reason : "Connection closed.");
  }
  async kick(storyId: string) {
    await this.ctx.storage.put("storyId", storyId);
    // D1 chooses the head and owns execution authority even if this object is evicted.
    await this.env.DB.prepare(
      `UPDATE stories SET active_task_id=(SELECT id FROM tasks WHERE story_id=? AND status='Queued' ORDER BY queue_sequence LIMIT 1) WHERE id=? AND status='open' AND active_task_id IS NULL`,
    )
      .bind(storyId, storyId)
      .run();
    const row = await this.env.DB.prepare(
      "SELECT t.id,t.status,t.workflow_id,t.queue_sequence,t.provider_request_id,t.source_kind,t.base_version FROM stories s JOIN tasks t ON t.id=s.active_task_id WHERE s.id=?",
    )
      .bind(storyId)
      .first<{
        id: string;
        source_kind: string;
        base_version: number;
        status: string;
        workflow_id: string | null;
        provider_request_id: string | null;
        queue_sequence: number;
      }>();
    if (
      !row ||
      ["NeedsModeration", "ReconciliationNeeded"].includes(row.status)
    ) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    if (row.source_kind === "upload") {
      await this.env.DB.prepare(
        `UPDATE tasks SET status=CASE WHEN base_version=(SELECT version FROM stories WHERE id=tasks.story_id) THEN 'NeedsModeration' ELSE 'NeedsReview' END, reason=CASE WHEN base_version=(SELECT version FROM stories WHERE id=tasks.story_id) THEN 'Review the uploaded footage before publication.' ELSE 'The story advanced. Review how your finished video continues the latest scene.' END,updated_at=? WHERE id=? AND status IN ('Queued','Preparing')`,
      )
        .bind(Date.now(), row.id)
        .run();
      // Revisit the queue after a stale upload releases its reservation.
      await this.ctx.storage.setAlarm(Date.now() + 1000);
      await this.broadcast({ type: "queue.updated", storyId, taskId: row.id });
      return;
    }
    if (row.status === "Queued")
      await this.env.DB.prepare(
        "UPDATE tasks SET status='Preparing',updated_at=? WHERE id=? AND status='Queued'",
      )
        .bind(Date.now(), row.id)
        .run();
    const workflowId =
      row.workflow_id ?? `scene-${row.id}-${row.queue_sequence}`;
    await this.env.DB.prepare(
      "UPDATE tasks SET workflow_id=? WHERE id=? AND workflow_id IS NULL",
    )
      .bind(workflowId, row.id)
      .run();
    try {
      await this.env.GENERATION.create({
        id: workflowId,
        params: {
          taskId: row.id,
          storyId,
          resumeKnown: row.status === "Generating" && !!row.provider_request_id,
        },
      });
    } catch (error) {
      try {
        const instance = await this.env.GENERATION.get(workflowId);
        const status = await instance.status();
        if (["errored", "terminated", "complete"].includes(status.status)) {
          await transition(
            this.env,
            row.id,
            ["Preparing", "Generating", "Checking", "Packaging"],
            "ReconciliationNeeded",
            "The workflow stopped before this scene was ready. The studio must reconcile it before continuing.",
          );
          await audit(this.env, null, "workflow.needs-recovery", row.id, {
            status: status.status,
          });
          await this.ctx.storage.deleteAlarm();
          return;
        }
      } catch {
        throw error;
      }
    }
    await this.ctx.storage.setAlarm(Date.now() + 60000);
    await this.broadcast({ type: "queue.updated", storyId, taskId: row.id });
  }
  async alarm() {
    const id = await this.ctx.storage.get<string>("storyId");
    if (id) await this.kick(id);
  }
}
