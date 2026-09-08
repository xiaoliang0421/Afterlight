import { getLocale, t as tr } from "./i18n";
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
import {
  operationLabels,
  type OperationName,
  type OperationResult,
} from "../shared/operations";
import { api, useResource } from "./api";
import { useApp } from "./context";
import { CommunityPanel } from "./CommunityPanel";
import { MaterialsPanel } from "./MaterialsPanel";
import { StudioRequests } from "./StudioRequests";
import { SpeechReview } from "./SpeechReview";
import { ArchiveReview } from "./ArchiveReview";
import { StudioBilling } from "./StudioBilling";
import { VideoCostReview } from "./VideoCostReview";
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
  costStatus: string;
  reservedCents: number;
  reservationActive: boolean;
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
  operations: {
    runtime: OperationResult | null;
    components: OperationResult[];
    queue: {
      held: number;
      missingRequestIds: number;
      reservedCents: number;
    } | null;
    overdue: boolean;
  };
}
const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
export function StudioPage() {
  const { boot, toast, refresh } = useApp(),
    resource = useResource<StudioData>(
      boot.user?.role === "admin" ? "/admin" : null,
    );
  const [review, setReview] = useState<StudioTask | null>(null),
    [resolve, setResolve] = useState<StudioTask | null>(null),
    [costReview, setCostReview] = useState<StudioTask | null>(null),
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
          title={tr("The studio is a private workspace.")}
        >
          {tr(
            "Sign in with a studio account to review scenes and manage operations.",
          )}
        </Empty>
      </div>
    );
  if (resource.loading) return <Loading />;
  if (!resource.data)
    return (
      <div className="page">
        <Notice danger>{tr(resource.error)}</Notice>
        <Button onClick={() => void resource.reload()}>{tr("Retry")}</Button>
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
          <p className="eyebrow">{tr("BEHIND THE SCENES")}</p>
          <h1>{tr("The studio.")}</h1>
          <p>
            {tr(
              "Keep the worlds coherent, the credits fair and the costs visible.",
            )}
          </p>
        </div>
        <Button kind="secondary" onClick={() => void reload()}>
          <RefreshCw size={15} />
          {tr("Refresh")}
        </Button>
      </div>
      <div className="metrics-grid">
        <div>
          <Clapperboard size={18} />
          <span>{tr("Scenes awaiting attention")}</span>
          <strong>{pending.length}</strong>
        </div>
        <div>
          <DollarSign size={18} />
          <span>{tr("Recorded cost ceilings")}</span>
          <strong>{dollars(d.recordedSpendCents)}</strong>
        </div>
        <div>
          <Activity size={18} />
          <span>{tr("Provider balance snapshot")}</span>
          <strong>{dollars(d.settings.providerBalanceCents)}</strong>
          <small>
            {d.settings.providerCheckedAt
              ? new Date(d.settings.providerCheckedAt).toLocaleTimeString(
                  getLocale(),
                )
              : tr("Not checked")}
          </small>
        </div>
        <div>
          <ShieldCheck size={18} />
          <span>{tr("Authorized spending ceiling")}</span>
          <strong>{dollars(d.authorizedSpendCents)}</strong>
        </div>
      </div>
      <div
        className="content-tabs"
        role="tablist"
        aria-label={tr("Studio sections")}
      >
        {[
          "Review queue",
          "Stories & community",
          "Character materials",
          "Story guides",
          "Account requests",
          "Payments",
          "Capacity & settings",
          "Reports",
          "Activity log",
          "Operations",
        ]
          .filter((t) => t !== "Payments" || boot.config.billingVisible)
          .map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
            >
              {tr(t)}
            </button>
          ))}
      </div>
      {tab === "Stories & community" && <CommunityPanel />}
      {tab === "Operations" && (
        <section className="panel">
          <h2>{tr("Recovery & protection")}</h2>
          <p>
            {tr("Last successful scheduled check:")}{" "}
            {d.operations.runtime?.completedAt
              ? new Date(d.operations.runtime.completedAt).toLocaleString(
                  getLocale(),
                )
              : tr("No scheduled checks recorded yet.")}
          </p>
          {d.operations.overdue && (
            <Notice danger>
              {tr(
                "Scheduled reconciliation has not completed in the last 15 minutes. Check Cloudflare Worker logs and cron triggers.",
              )}
            </Notice>
          )}
          {d.operations.runtime?.status === "failed" && (
            <Notice danger>
              {tr(
                "The latest scheduled check was incomplete. Review the failed checks below. Other recovery work continues independently.",
              )}
            </Notice>
          )}
          {!!d.operations.components?.length && (
            <div className="operation-checks">
              <table>
                <thead>
                  <tr>
                    <th>{tr("Scheduled check")}</th>
                    <th>{tr("Latest result")}</th>
                    <th>{tr("Last success")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.operations.components.map((operation) => (
                    <tr key={operation.name}>
                      <td>
                        {tr(
                          operationLabels[operation.name as OperationName] ??
                            operation.name,
                        )}
                      </td>
                      <td>
                        {operation.status === "failed" ? (
                          <strong className="danger-text">
                            {tr("Needs attention")}
                          </strong>
                        ) : operation.status === "succeeded" ? (
                          tr("Passed")
                        ) : operation.status === "skipped" ? (
                          tr("Not enabled")
                        ) : operation.status === "running" ? (
                          tr("Running")
                        ) : (
                          tr("Not checked")
                        )}
                      </td>
                      <td>
                        {operation.completedAt
                          ? new Date(operation.completedAt).toLocaleString(
                              getLocale(),
                            )
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p>
            {d.operations.queue?.held ?? 0} {tr("attempts on hold ·")}{" "}
            {d.operations.queue?.missingRequestIds ?? 0}{" "}
            {tr("missing provider IDs ·")}{" "}
            {dollars(d.operations.queue?.reservedCents ?? 0)} {tr("reserved")}
          </p>
          <p>
            {tr("Creation verification:")}{" "}
            {d.readiness.turnstile
              ? tr(
                  "Keys configured; confirm the live widget and host in staging.",
                )
              : tr(
                  "Not configured. Remote creation stays closed; local fixtures can be tested offline.",
                )}
          </p>
          <p className="fine-print">
            {tr(
              "Recovery uses the existing provider request. Do not restart a paid submission or remove its attempt marker. These diagnostics are visible only to the studio.",
            )}
          </p>
        </section>
      )}
      {tab === "Character materials" && <MaterialsPanel />}
      {tab === "Story guides" && <ArchiveReview />}
      {tab === "Account requests" && <StudioRequests />}
      {tab === "Payments" && <StudioBilling />}
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
                <h3>{t.plan?.title || tr("A new scene")}</h3>
                <p>{t.plan?.summary || t.prompt}</p>
                <Author id={t.userId} name={t.author} compact />
                {t.reason && <p className="fine-print">{t.reason}</p>}
                {t.providerRequestId && (
                  <p className="fine-print">
                    {tr("Video cost:")} {dollars(t.recordedCostCents)} ·{" "}
                    {t.costStatus === "reconciled"
                      ? tr("Verified")
                      : tr("Estimated ceiling")}
                  </p>
                )}
                {t.status === "NeedsModeration" && (
                  <Button kind="secondary" onClick={() => setReview(t)}>
                    {tr("Watch & review")} <ArrowRight size={15} />
                  </Button>
                )}
                {t.status === "ReconciliationNeeded" && (
                  <Button kind="secondary" onClick={() => setResolve(t)}>
                    {tr("Reconcile request")}
                  </Button>
                )}
                {t.status === "NeedsModeration" &&
                  t.reservationActive &&
                  t.costStatus === "estimated-ceiling" &&
                  t.providerRequestId &&
                  t.videoUrl &&
                  !boot.stories.find((s) => s.id === t.storyId)?.fixture && (
                    <Button kind="secondary" onClick={() => setCostReview(t)}>
                      {tr("Check video cost")}
                    </Button>
                  )}
              </article>
            ))
          ) : (
            <Empty icon={<Check size={30} />} title={tr("A clear horizon.")}>
              {tr("Scenes will appear here when they need a studio review.")}
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
            <h2>{tr("Provider readiness")}</h2>
            <div className="readiness-list">
              {Object.entries(d.readiness).map(([key, ok]) => (
                <div key={key}>
                  <span>{key}</span>
                  <b className={ok ? "ready" : "not-ready"}>
                    {ok ? tr("Configured") : tr("Not configured")}
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
              {tr("Check provider balance")}
            </Button>
            <p className="fine-print">
              {tr(
                "Model balances and platform budgets are separate. Cost ceilings remain conservative until actual charges are reconciled.",
              )}
            </p>
            <h3>{tr("Budget periods")}</h3>
            {d.budgets.map((b) => (
              <div className="budget-row" key={`${b.kind}${b.period}`}>
                <strong>{b.period}</strong>
                <span>
                  {dollars(b.spent_cents)} {tr("recorded ·")}{" "}
                  {dollars(b.reserved_cents)} {tr("reserved")}
                  <br />
                  {dollars(b.limit_cents)} {tr("limit")}
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
                  <span className="eyebrow">{tr(r.status)}</span>
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
                    {tr("Mark resolved")}
                  </Button>
                )}
              </article>
            ))
          ) : (
            <Empty
              icon={<ShieldCheck size={28} />}
              title={tr("No reports waiting.")}
            >
              {tr("Reports and support requests will appear here.")}
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
              <time>{new Date(l.created_at).toLocaleString(getLocale())}</time>
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
      {costReview && (
        <VideoCostReview
          task={costReview}
          close={() => setCostReview(null)}
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
      <h2>{tr("Creation capacity")}</h2>
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
          <span>{tr("Accept new generation tasks")}</span>
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
            {tr(label)}
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
          {tr(
            "Changing these limits does not grant additional spending authorization or revoke in-flight reservations. Checkout stays disabled.",
          )}
        </p>
        {error && <Notice danger>{tr(error)}</Notice>}
        <Button type="submit" busy={busy}>
          {tr("Save capacity settings")}
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
    [checks, setChecks] = useState([false, false, false, false, false]),
    [updates, setUpdates] = useState(
      JSON.stringify(task.plan?.characterUpdates ?? [], null, 2),
    ),
    [newIds, setNewIds] = useState<string[]>([]),
    [rejectReason, setRejectReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const ideas = useResource<{
    ideas: {
      id: string;
      prompt: string;
      nickname: string;
      publicName: string;
    }[];
  }>(`/admin/community/tasks/${task.id}/ideas`);
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
          publicTextReviewed: checks[4],
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
      title={tr("Review what actually happened.")}
      eyebrow={tr("PUBLISH ONLY WHAT THE VIDEO SHOWS")}
      onClose={close}
    >
      <video
        className="review-video"
        src={task.videoUrl ?? ""}
        controls
        playsInline
      />
      <Author id={task.userId} name={task.author} label={tr("PRODUCED BY")} />
      <p className="modal-copy">
        {tr(
          "The plan below is a starting point. Correct it to match the actual video before it becomes story history.",
        )}
      </p>
      {task.sourceKind !== "upload" && (
        <SpeechReview taskId={task.id} onCaptions={setCaptions} />
      )}
      <h4>{tr("Original submitted text")}</h4>
      <p className="preserve-lines">{task.prompt}</p>
      <h4>{tr("Adopted audience ideas and public credits")}</h4>
      {ideas.error && <Notice danger>{tr(ideas.error)}</Notice>}
      {ideas.loading && <Loading />}
      {ideas.data?.ideas.map((p) => (
        <article key={p.id}>
          <strong>{p.publicName || tr("Storyteller")}</strong>
          <p className="preserve-lines">{p.prompt}</p>
        </article>
      ))}
      {ideas.data?.ideas.length === 0 && (
        <p>{tr("No adopted audience ideas.")}</p>
      )}
      <div className="review-checks">
        {[
          "The actual audio is English (or there is no speech).",
          "Readable text is English and appropriate.",
          "Characters, props and events continue the latest story.",
          "The content and references are safe to publish.",
          "The original text, adopted ideas, credits, title and summary are safe to publish and contain no private information.",
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
            <span>{tr(label)}</span>
          </label>
        ))}
      </div>
      <label className="field-label">
        {tr("What the video actually shows")}
        <textarea
          rows={3}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      </label>
      <label className="field-label">
        {tr("Published facts · one per line")}
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
        <span>{tr("This clip has no dialogue or narration.")}</span>
      </label>
      {!noDialogue && (
        <label className="field-label">
          {tr("Reviewed English WebVTT captions")}
          <textarea
            rows={5}
            value={captions}
            onChange={(e) => setCaptions(e.target.value)}
          />
        </label>
      )}
      <details className="advanced-review">
        <summary>{tr("Character state changes")}</summary>
        <p className="fine-print">
          {tr(
            "Only approved state changes enter canon. Remove any change not shown in the video.",
          )}
        </p>
        <textarea
          aria-label={tr("Approved character state changes as JSON")}
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
              {ch.name}{" "}
              {tr("actually appears and may enter the character registry.")}
            </span>
          </label>
        ))}
      </details>
      {error && <Notice danger>{tr(error)}</Notice>}
      <Button
        className="full-width"
        busy={busy}
        disabled={!checks.every(Boolean) || !ideas.data || !!ideas.error}
        onClick={() => void act(true)}
      >
        {tr("Approve & publish with author credit")} <Check size={16} />
      </Button>
      <div className="reject-section">
        <label className="field-label">
          {tr("Or return the author’s credit with an explanation")}
          <textarea
            rows={2}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder={tr("What needs to change?")}
          />
        </label>
        <Button
          kind="danger"
          busy={busy}
          disabled={rejectReason.trim().length < 10}
          onClick={() => void act(false)}
        >
          {tr("Reject this result")}
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
    [requestId, setRequestId] = useState(task.providerRequestId ?? ""),
    [linked, setLinked] = useState(!!task.providerRequestId),
    [evidence, setEvidence] = useState<{
      model: string;
      sentAt: string;
      status: string;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const recover = async (confirm: boolean) => {
    setBusy(true);
    setError("");
    try {
      const result = await api<{
        model: string;
        sentAt: string;
        status: string;
      }>(`/admin/tasks/${task.id}/recovery`, "POST", {
        requestId,
        reason,
        confirm,
      });
      setEvidence(result);
      if (confirm) {
        setLinked(true);
        await done();
      }
    } catch (e) {
      setError((e as Error).message);
      setEvidence(null);
    } finally {
      setBusy(false);
    }
  };
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
      title={tr("Reconcile before retrying.")}
      eyebrow={tr("PROVIDER REQUEST RECOVERY")}
      onClose={close}
    >
      <p className="modal-copy">
        {tr("Provider request:")}{" "}
        <code>
          {linked
            ? requestId
            : tr("Not yet recorded — check the provider request log.")}
        </code>
      </p>
      <label className="field-label">
        {tr("What did you verify?")}
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {!linked && (
        <>
          <label className="field-label">
            {tr("Existing fal request ID")}
            <input
              value={requestId}
              onChange={(e) => {
                setRequestId(e.target.value.trim());
                setEvidence(null);
              }}
              placeholder={tr("Request UUID from the fal dashboard")}
            />
          </label>
          <p className="fine-print">
            {tr(
              "Read-only verification compares the model, submission time and saved input. Older attempts without saved evidence remain on hold.",
            )}
          </p>
          <Button
            kind="secondary"
            busy={busy}
            disabled={!requestId || reason.trim().length < 10}
            onClick={() => void recover(false)}
          >
            {tr("Verify existing request")}
          </Button>
          {evidence && (
            <Notice>
              <p>
                {evidence.model} · {evidence.status}
                <br />
                {tr("Sent")}{" "}
                {new Date(evidence.sentAt).toLocaleString(getLocale())}
              </p>
              <p>
                {tr(
                  "The saved input matches. Linking keeps this task on hold until you resume it.",
                )}
              </p>
              <Button busy={busy} onClick={() => void recover(true)}>
                {tr("Link this verified request")}
              </Button>
            </Notice>
          )}
        </>
      )}
      {linked && (
        <Button
          busy={busy}
          disabled={reason.length < 10}
          onClick={() => void act(true)}
        >
          {tr("Resume the existing request")}
        </Button>
      )}
      <label className="field-label">
        {tr("Or close as failed · actual reconciled provider cost in cents")}
        <input
          type="number"
          min={0}
          value={cost}
          onChange={(e) => setCost(e.target.value)}
        />
      </label>
      <p className="fine-print">
        {tr(
          "Only close after confirming the provider request is finished or was never accepted. The author’s credit is returned; upstream costs remain in the ledger.",
        )}
      </p>
      {error && <Notice danger>{tr(error)}</Notice>}
      <Button
        kind="secondary"
        busy={busy}
        disabled={reason.length < 10 || cost === ""}
        onClick={() => void act(false)}
      >
        {tr("Close & return the creation credit")}
      </Button>
    </Modal>
  );
}
