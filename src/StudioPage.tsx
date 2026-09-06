import { useState } from "react";
import {
  Activity,
  ArrowRight,
  Check,
  Clapperboard,
  DollarSign,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type { Settings, Task } from "../shared/domain";
import { api, useResource } from "./api";
import { useApp } from "./context";
import { MaterialsPanel } from "./MaterialsPanel";
import { StudioRequests } from "./StudioRequests";
import {
  Author,
  Button,
  Empty,
  Loading,
  Modal,
  Notice,
  Status,
} from "./components";

type StudioTask = Task & {
  videoUrl: string | null;
  recordedCostCents: number;
  providerRequestId: string | null;
};
interface StudioData {
  settings: Settings;
  tasks: StudioTask[];
  budgets: {
    kind: string;
    period: string;
    limit_cents: number;
    reserved_cents: number;
    spent_cents: number;
  }[];
  reports: {
    id: string;
    story_id: string;
    reason: string;
    author: string;
    status: string;
  }[];
  logs: { action: string; target_id: string; created_at: number }[];
  authorizedSpendCents: number;
  recordedSpendCents: number;
  readiness: Record<string, boolean>;
}
const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
export function StudioPage() {
  const { boot, toast, refresh } = useApp(),
    resource = useResource<StudioData>(
      boot.user?.role === "admin" ? "/admin" : null,
    );
  const [review, setReview] = useState<StudioTask | null>(null),
    [resolve, setResolve] = useState<StudioTask | null>(null),
    [tab, setTab] = useState("Review queue"),
    [busy, setBusy] = useState(false);
  const reload = async () => {
    await resource.reload();
    await refresh();
  };
  if (boot.user?.role !== "admin")
    return (
      <div className="page">
        <Empty
          icon={<ShieldCheck size={32} />}
          title="The studio is a private workspace."
        >
          Sign in with a studio account to review scenes and manage operations.
        </Empty>
      </div>
    );
  if (resource.loading) return <Loading />;
  if (!resource.data)
    return (
      <div className="page">
        <Notice danger>{resource.error}</Notice>
        <Button onClick={() => void resource.reload()}>Retry</Button>
      </div>
    );
  const d = resource.data,
    pending = d.tasks.filter((t) =>
      ["NeedsModeration", "ReconciliationNeeded"].includes(t.status),
    );
  return (
    <div className="page studio-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">BEHIND THE SCENES</p>
          <h1>The studio.</h1>
          <p>
            Keep the worlds coherent, the credits fair and the costs visible.
          </p>
        </div>
        <Button kind="secondary" onClick={() => void reload()}>
          <RefreshCw size={15} />
          Refresh
        </Button>
      </div>
      <div className="metrics-grid">
        <div>
          <Clapperboard size={18} />
          <span>Scenes awaiting attention</span>
          <strong>{pending.length}</strong>
        </div>
        <div>
          <DollarSign size={18} />
          <span>Recorded cost ceilings</span>
          <strong>{dollars(d.recordedSpendCents)}</strong>
        </div>
        <div>
          <Activity size={18} />
          <span>Provider balance snapshot</span>
          <strong>{dollars(d.settings.providerBalanceCents)}</strong>
          <small>
            {d.settings.providerCheckedAt
              ? new Date(d.settings.providerCheckedAt).toLocaleTimeString("en")
              : "Not checked"}
          </small>
        </div>
        <div>
          <ShieldCheck size={18} />
          <span>Authorized spending ceiling</span>
          <strong>{dollars(d.authorizedSpendCents)}</strong>
        </div>
      </div>
      <div className="content-tabs" role="tablist" aria-label="Studio sections">
        {[
          "Review queue",
          "Character materials",
          "Account requests",
          "Capacity & settings",
          "Reports",
          "Activity log",
        ].map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Character materials" && <MaterialsPanel />}
      {tab === "Account requests" && <StudioRequests />}
      {tab === "Review queue" && (
        <div className="studio-tasks">
          {d.tasks.length ? (
            d.tasks.map((t) => (
              <article className="studio-task" key={t.id}>
                <div className="section-heading">
                  <span className="eyebrow">
                    {boot.stories.find((s) => s.id === t.storyId)?.title ??
                      t.storyId}
                  </span>
                  <Status state={t.status} />
                </div>
                <h3>{t.plan?.title || "A new scene"}</h3>
                <p>{t.plan?.summary || t.prompt}</p>
                <Author id={t.userId} name={t.author} compact />
                {t.reason && <p className="fine-print">{t.reason}</p>}
                {t.status === "NeedsModeration" && (
                  <Button kind="secondary" onClick={() => setReview(t)}>
                    Watch & review <ArrowRight size={15} />
                  </Button>
                )}
                {t.status === "ReconciliationNeeded" && (
                  <Button kind="secondary" onClick={() => setResolve(t)}>
                    Reconcile request
                  </Button>
                )}
              </article>
            ))
          ) : (
            <Empty icon={<Check size={30} />} title="A clear horizon.">
              Scenes will appear here when they need a studio review.
            </Empty>
          )}
        </div>
      )}
      {tab === "Capacity & settings" && (
        <div className="studio-settings">
          <SettingsForm
            initial={d.settings}
            ceiling={d.authorizedSpendCents}
            done={reload}
          />
          <section className="form-panel">
            <h2>Provider readiness</h2>
            <div className="readiness-list">
              {Object.entries(d.readiness).map(([key, ok]) => (
                <div key={key}>
                  <span>{key}</span>
                  <b className={ok ? "ready" : "not-ready"}>
                    {ok ? "Configured" : "Not configured"}
                  </b>
                </div>
              ))}
            </div>
            <Button
              kind="secondary"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api("/admin/balance/refresh", "POST", {});
                  await reload();
                  toast(
                    "Provider balance checked. Unreconciled costs remain reserved.",
                  );
                } catch (e) {
                  toast((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Check provider balance
            </Button>
            <p className="fine-print">
              Model balances and platform budgets are separate. Cost ceilings
              remain conservative until actual charges are reconciled.
            </p>
            <h3>Budget periods</h3>
            {d.budgets.map((b) => (
              <div className="budget-row" key={`${b.kind}${b.period}`}>
                <strong>{b.period}</strong>
                <span>
                  {dollars(b.spent_cents)} recorded ·{" "}
                  {dollars(b.reserved_cents)} reserved
                  <br />
                  {dollars(b.limit_cents)} limit
                </span>
              </div>
            ))}
          </section>
        </div>
      )}
      {tab === "Reports" && (
        <div className="stack">
          {d.reports.length ? (
            d.reports.map((r) => (
              <article className="form-panel" key={r.id}>
                <div className="section-heading">
                  <strong>{r.author}</strong>
                  <span className="eyebrow">{r.status}</span>
                </div>
                <p>{r.reason}</p>
                {r.status === "open" && (
                  <Button
                    kind="secondary"
                    onClick={async () => {
                      try {
                        await api(`/admin/reports/${r.id}/resolve`, "POST", {});
                        await reload();
                      } catch (e) {
                        toast((e as Error).message);
                      }
                    }}
                  >
                    Mark resolved
                  </Button>
                )}
              </article>
            ))
          ) : (
            <Empty icon={<ShieldCheck size={28} />} title="No reports waiting.">
              Reports and support requests will appear here.
            </Empty>
          )}
        </div>
      )}
      {tab === "Activity log" && (
        <div className="audit-list">
          {d.logs.map((l, i) => (
            <div key={i}>
              <span>{l.action}</span>
              <code>{l.target_id}</code>
              <time>{new Date(l.created_at).toLocaleString("en")}</time>
            </div>
          ))}
        </div>
      )}
      {review && (
        <ModerationModal
          task={review}
          close={() => setReview(null)}
          done={reload}
        />
      )}
      {resolve && (
        <ResolveModal
          task={resolve}
          close={() => setResolve(null)}
          done={reload}
        />
      )}
    </div>
  );
}
function SettingsForm({
  initial,
  ceiling,
  done,
}: {
  initial: Settings;
  ceiling: number;
  done: () => Promise<void>;
}) {
  const [form, setForm] = useState(initial),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="form-panel">
      <h2>Creation capacity</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api("/admin/settings", "PATCH", {
              generationEnabled: form.generationEnabled,
              dailyCredits: form.dailyCredits,
              dailyBudgetCents: form.dailyBudgetCents,
              monthlyBudgetCents: form.monthlyBudgetCents,
              maxQueuePerStory: form.maxQueuePerStory,
            });
            await done();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={form.generationEnabled}
            onChange={(e) =>
              setForm({ ...form, generationEnabled: e.target.checked })
            }
          />
          <span>Accept new generation tasks</span>
        </label>
        {(
          [
            ["dailyCredits", "Daily free credits per user"],
            ["maxQueuePerStory", "Maximum queued ideas per story"],
            ["dailyBudgetCents", "Daily budget · cents"],
            ["monthlyBudgetCents", "Monthly budget · cents"],
          ] as const
        ).map(([key, label]) => (
          <label className="field-label" key={key}>
            {label}
            <input
              type="number"
              min={0}
              max={key.includes("Budget") ? ceiling : 100}
              required
              value={form[key]}
              onChange={(e) =>
                setForm({ ...form, [key]: Number(e.target.value) })
              }
            />
          </label>
        ))}
        <p className="fine-print">
          Changing these limits does not grant additional spending authorization
          or revoke in-flight reservations. Checkout stays disabled.
        </p>
        {error && <Notice danger>{error}</Notice>}
        <Button type="submit" busy={busy}>
          Save capacity settings
        </Button>
      </form>
    </section>
  );
}
function ModerationModal({
  task,
  close,
  done,
}: {
  task: StudioTask;
  close: () => void;
  done: () => Promise<void>;
}) {
  const [summary, setSummary] = useState(task.plan?.summary ?? ""),
    [events, setEvents] = useState(task.plan?.proposedEvents.join("\n") ?? ""),
    [captions, setCaptions] = useState("WEBVTT\n\n"),
    [noDialogue, setNoDialogue] = useState(false),
    [checks, setChecks] = useState([false, false, false, false]),
    [updates, setUpdates] = useState(
      JSON.stringify(task.plan?.characterUpdates ?? [], null, 2),
    ),
    [newIds, setNewIds] = useState<string[]>([]),
    [rejectReason, setRejectReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const act = async (approve: boolean) => {
    setBusy(true);
    setError("");
    try {
      if (approve)
        await api(`/admin/tasks/${task.id}/approve`, "POST", {
          summary,
          events: events
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          englishAudio: checks[0],
          englishText: checks[1],
          continuity: checks[2],
          contentSafe: checks[3],
          captions,
          noDialogue,
          characterUpdates: JSON.parse(updates),
          newCharacterIds: newIds,
        });
      else
        await api(`/admin/tasks/${task.id}/reject`, "POST", {
          reason: rejectReason,
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
      wide
      title="Review what actually happened."
      eyebrow="PUBLISH ONLY WHAT THE VIDEO SHOWS"
      onClose={close}
    >
      <video
        className="review-video"
        src={task.videoUrl ?? ""}
        controls
        playsInline
      />
      <Author id={task.userId} name={task.author} label="IDEA CONTRIBUTED BY" />
      <p className="modal-copy">
        The plan below is a starting point. Correct it to match the actual video
        before it becomes story history.
      </p>
      <div className="review-checks">
        {[
          "The actual audio is English (or there is no speech).",
          "Readable text is English and appropriate.",
          "Characters, props and events continue the latest story.",
          "The content and references are safe to publish.",
        ].map((label, i) => (
          <label className="checkbox-label" key={label}>
            <input
              type="checkbox"
              checked={checks[i]}
              onChange={(e) =>
                setChecks((cs) =>
                  cs.map((v, j) => (i === j ? e.target.checked : v)),
                )
              }
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <label className="field-label">
        What the video actually shows
        <textarea
          rows={3}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      </label>
      <label className="field-label">
        Published facts · one per line
        <textarea
          rows={3}
          value={events}
          onChange={(e) => setEvents(e.target.value)}
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={noDialogue}
          onChange={(e) => setNoDialogue(e.target.checked)}
        />
        <span>This clip has no dialogue or narration.</span>
      </label>
      {!noDialogue && (
        <label className="field-label">
          Reviewed English WebVTT captions
          <textarea
            rows={5}
            value={captions}
            onChange={(e) => setCaptions(e.target.value)}
          />
        </label>
      )}
      <details className="advanced-review">
        <summary>Character state changes</summary>
        <p className="fine-print">
          Only approved state changes enter canon. Remove any change not shown
          in the video.
        </p>
        <textarea
          aria-label="Approved character state changes as JSON"
          rows={4}
          value={updates}
          onChange={(e) => setUpdates(e.target.value)}
        />
        {task.plan?.newCharacters.map((ch) => (
          <label className="checkbox-label" key={ch.id}>
            <input
              type="checkbox"
              checked={newIds.includes(ch.id)}
              onChange={(e) =>
                setNewIds((ids) =>
                  e.target.checked
                    ? [...ids, ch.id]
                    : ids.filter((id) => id !== ch.id),
                )
              }
            />
            <span>
              {ch.name} actually appears and may enter the character registry.
            </span>
          </label>
        ))}
      </details>
      {error && <Notice danger>{error}</Notice>}
      <Button
        className="full-width"
        busy={busy}
        disabled={!checks.every(Boolean)}
        onClick={() => void act(true)}
      >
        Approve & publish with author credit <Check size={16} />
      </Button>
      <div className="reject-section">
        <label className="field-label">
          Or return the author’s credit with an explanation
          <textarea
            rows={2}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="What needs to change?"
          />
        </label>
        <Button
          kind="danger"
          busy={busy}
          disabled={rejectReason.trim().length < 10}
          onClick={() => void act(false)}
        >
          Reject this result
        </Button>
      </div>
    </Modal>
  );
}
function ResolveModal({
  task,
  close,
  done,
}: {
  task: StudioTask;
  close: () => void;
  done: () => Promise<void>;
}) {
  const [reason, setReason] = useState(""),
    [cost, setCost] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const act = async (resume: boolean) => {
    setBusy(true);
    try {
      await api(`/admin/tasks/${task.id}/resolve`, "POST", {
        action: resume ? "resume-known-request" : "fail-confirmed",
        reason,
        recordedCostCents: resume ? undefined : Number(cost),
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
      title="Reconcile before retrying."
      eyebrow="PROVIDER REQUEST RECOVERY"
      onClose={close}
    >
      <p className="modal-copy">
        Provider request:{" "}
        <code>
          {task.providerRequestId ??
            "Not yet recorded — check the provider request log."}
        </code>
      </p>
      <label className="field-label">
        What did you verify?
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {task.providerRequestId && (
        <Button
          busy={busy}
          disabled={reason.length < 10}
          onClick={() => void act(true)}
        >
          Resume the existing request
        </Button>
      )}
      <label className="field-label">
        Or close as failed · actual reconciled provider cost in cents
        <input
          type="number"
          min={0}
          value={cost}
          onChange={(e) => setCost(e.target.value)}
        />
      </label>
      <p className="fine-print">
        Only close after confirming the provider request is finished or was
        never accepted. The author’s credit is returned; upstream costs remain
        in the ledger.
      </p>
      {error && <Notice danger>{error}</Notice>}
      <Button
        kind="secondary"
        busy={busy}
        disabled={reason.length < 10 || cost === ""}
        onClick={() => void act(false)}
      >
        Close & return the creation credit
      </Button>
    </Modal>
  );
}
