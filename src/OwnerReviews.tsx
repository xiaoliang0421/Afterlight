import { useEffect, useState } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import type { Task } from "../shared/domain";
import {
  majorChangeLabels,
  needsOwnerReview,
  type OwnerReviewItem,
} from "../shared/governance";
import { api, useResource } from "./api";
import { useApp } from "./context";
import {
  Author,
  Button,
  Empty,
  Link,
  Loading,
  Modal,
  Notice,
} from "./components";

export function waitingForOwner(task: Task) {
  return needsOwnerReview(task.plan) && task.ownerReview?.status !== "approved";
}

export function OwnerApprovalGate({
  task,
  onChange,
}: {
  task: Task;
  onChange: (task: Task) => void;
}) {
  const [share, setShare] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const status = task.ownerReview?.status;
  useEffect(() => {
    setShare(false);
    setError("");
  }, [task.id, task.plan]);
  useEffect(() => {
    if (status !== "pending") return;
    let stopped = false;
    const timer = setInterval(() => {
      if (!document.hidden)
        void api<{ task: Task }>(`/tasks/${task.id}`)
          .then((r) => {
            if (!stopped) onChange(r.task);
          })
          .catch(() => {});
    }, 10000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [task.id, status]);
  if (!needsOwnerReview(task.plan)) return null;
  const act = async (action: "request" | "refresh" | "preview") => {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ task: Task }>(
        `/tasks/${task.id}${action === "request" ? "/owner-review" : action === "preview" ? "/preview" : ""}`,
        action === "refresh" ? "GET" : "POST",
        action === "request"
          ? { planUpdatedAt: task.updatedAt, shareWithOwner: share }
          : action === "preview"
            ? {}
            : undefined,
      );
      onChange(result.task);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="owner-approval-gate"
      aria-label="Story creator approval"
      aria-live="polite"
    >
      <span className="eyebrow">
        <ShieldCheck size={15} /> STORY CREATOR’S DECISION
      </span>
      <p>
        {task
          .plan!.majorChanges.map((change) => majorChangeLabels[change])
          .join(" · ")}
      </p>
      <Notice>
        {status === "approved"
          ? "Approved for this plan and story version. Confirm below to join the queue."
          : status === "pending"
            ? "Waiting for the story creator. No generation credit is reserved, and other ideas can keep moving."
            : status === "rejected"
              ? "The story creator declined this plan. You can withdraw it and propose a different direction."
              : status === "expired"
                ? "The story advanced. Prepare a fresh preview before requesting another decision."
                : "This idea proposes a major change. The story creator must review it before generation."}
      </Notice>
      {task.ownerReview?.note && (
        <blockquote className="owner-decision-note">
          {task.ownerReview.note}
        </blockquote>
      )}
      {!status && (
        <>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={share}
              onChange={(e) => setShare(e.target.checked)}
            />
            <span>
              Share my original idea, nickname and this scene plan privately
              with the story creator for a decision.
            </span>
          </label>
          <Button
            className="full-width"
            busy={busy}
            disabled={!share}
            onClick={() => void act("request")}
          >
            Request the creator’s decision <ArrowRight size={15} />
          </Button>
        </>
      )}
      {status === "expired" && (
        <Button
          kind="secondary"
          busy={busy}
          onClick={() => void act("preview")}
        >
          Prepare a fresh preview
        </Button>
      )}
      {status === "pending" && (
        <Button
          kind="secondary"
          busy={busy}
          onClick={() => void act("refresh")}
        >
          Refresh decision
        </Button>
      )}
      {error && <Notice danger>{error}</Notice>}
    </section>
  );
}

export function OwnerReviews({ storyId }: { storyId?: string }) {
  const { boot, refresh } = useApp();
  const resource = useResource<{ reviews: OwnerReviewItem[] }>(
    boot.user
      ? `/owner-reviews${storyId ? `?storyId=${encodeURIComponent(storyId)}` : ""}`
      : null,
    [boot.user?.id],
  );
  const [selected, setSelected] = useState<OwnerReviewItem | null>(null);
  if (!boot.user) return null;
  const pending =
    resource.data?.reviews.filter((r) => r.status === "pending").length ?? 0;
  const reload = async () => {
    await resource.reload();
    await refresh();
  };
  return (
    <section className="owner-review-inbox" aria-label="Story decisions">
      <div className="section-heading">
        <div>
          <span className="eyebrow">FOR THE WORLDS YOU CREATED</span>
          <h2>Story decisions{pending > 0 ? ` · ${pending} waiting` : ""}</h2>
        </div>
        <Button kind="secondary" onClick={() => void reload()}>
          Refresh decisions
        </Button>
      </div>
      <p className="fine-print">
        Review major changes before video generation. Decisions apply to a
        specific plan; they do not rewrite published scenes or bypass the final
        video review.
      </p>
      {resource.loading && <Loading />}
      {resource.error && <Notice danger>{resource.error}</Notice>}
      {resource.data?.reviews.map((item) => (
        <article className="owner-review-row" key={item.id}>
          <div>
            <Link className="eyebrow" to={`/story/${item.storySlug}`}>
              {item.storyTitle}
            </Link>
            <h3>{item.plan.title}</h3>
            <Author id={item.authorId} name={item.author} compact />
            <p>{item.plan.summary}</p>
            <span className="fine-print">
              {item.status === "pending"
                ? "Waiting for your decision"
                : item.status}{" "}
              · Story version {item.baseVersion}
            </span>
          </div>
          <Button kind="secondary" onClick={() => setSelected(item)}>
            {item.status === "pending" ? "Review proposal" : "View decision"}
          </Button>
        </article>
      ))}
      {resource.data && !resource.data.reviews.length && (
        <Empty icon={<ShieldCheck size={26} />} title="No decisions waiting.">
          Major changes shared with you will appear here.
        </Empty>
      )}
      {selected && (
        <DecisionModal
          item={selected}
          close={() => setSelected(null)}
          done={reload}
        />
      )}
    </section>
  );
}

function DecisionModal({
  item,
  close,
  done,
}: {
  item: OwnerReviewItem;
  close: () => void;
  done: () => Promise<void>;
}) {
  const [note, setNote] = useState(""),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true);
    setError("");
    try {
      await api(`/owner-reviews/${item.id}/decision`, "POST", {
        decision,
        note,
        reviewedPlan: checked,
      });
      await done();
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={item.plan.title}
      eyebrow="STORY CHANGE PROPOSAL"
      onClose={close}
    >
      <Author id={item.authorId} name={item.author} />
      <p className="fine-print">
        {item.storyTitle} · Based on story version {item.baseVersion}
      </p>
      <Notice>
        {item.plan.majorChanges.map((c) => majorChangeLabels[c]).join(" · ")}
      </Notice>
      <details className="advanced-review" open>
        <summary>Current story context · version {item.contextVersion}</summary>
        <p>
          <strong>World rules</strong> · {item.worldRules}
        </p>
        <p>
          <strong>Latest published scene</strong> ·{" "}
          {item.latestSummary ?? "No scenes have been published yet."}
        </p>
        {item.cast.map((c) => (
          <p key={c.id}>
            <strong>{c.name}</strong> · {c.description}
            <br />
            Current state: {c.state}
          </p>
        ))}
      </details>
      <div className="bridge">
        <span>Original idea · shared privately</span>
        {item.prompt}
      </div>
      <div className="bridge">
        <span>English adaptation</span>
        {item.plan.englishPrompt}
      </div>
      <p className="modal-copy">{item.plan.summary}</p>
      <div className="bridge">
        <span>How it connects</span>
        {item.plan.bridge}
      </div>
      <p className="eyebrow">PROPOSED EVENTS</p>
      <ul>
        {item.plan.proposedEvents.map((event, i) => (
          <li key={i}>{event}</li>
        ))}
      </ul>
      <details className="advanced-review">
        <summary>Full scene plan, cast and state changes</summary>
        <p>{item.plan.videoPrompt}</p>
        <p>
          Cast:{" "}
          {item.plan.characterIds
            .map(
              (id) =>
                item.cast.find((c) => c.id === id)?.name ??
                item.plan.newCharacters.find((c) => c.id === id)?.name ??
                id,
            )
            .join(", ") || "None"}
        </p>
        {item.plan.newCharacters.map((c) => (
          <p key={c.id}>
            <strong>New: {c.name}</strong> · {c.description} · {c.state}
          </p>
        ))}
        {item.plan.characterUpdates.map((c) => (
          <p key={c.id}>
            <strong>
              {item.cast.find((ch) => ch.id === c.id)?.name ??
                item.plan.newCharacters.find((ch) => ch.id === c.id)?.name ??
                c.id}
            </strong>{" "}
            · {c.state}
          </p>
        ))}
      </details>
      <p className="fine-print">
        Approval lets the contributor confirm this plan and enter the normal
        queue. If the story advances, a new decision may be needed. Only the
        reviewed video can add facts to the story.
      </p>
      {item.status !== "pending" ? (
        <Notice>
          {item.status}
          {item.note
            ? `: ${item.note}`
            : " — this request no longer needs a decision."}
        </Notice>
      ) : (
        <>
          <label className="field-label">
            Your explanation to the contributor
            <textarea
              rows={3}
              maxLength={1200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Explain why this direction fits, or what should change."
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            <span>
              I reviewed this exact proposal against the story’s rules,
              characters and latest published events.
            </span>
          </label>
          {error && <Notice danger>{error}</Notice>}
          <div className="owner-decision-actions">
            <Button
              busy={busy}
              disabled={!checked || note.trim().length < 10}
              onClick={() => void decide("approved")}
            >
              Approve this direction
            </Button>
            <Button
              kind="secondary"
              busy={busy}
              disabled={!checked || note.trim().length < 10}
              onClick={() => void decide("rejected")}
            >
              Decline with explanation
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
