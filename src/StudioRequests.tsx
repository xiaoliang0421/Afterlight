import { getLocale, t as tr } from "./i18n";
import { useState } from "react";
import { api, useResource } from "./api";
import { Author, Button, Loading, Modal, Notice } from "./components";
import type { deletionPreview } from "../worker/account-deletion";
type DeletionPreview = Awaited<ReturnType<typeof deletionPreview>>;
export function StudioRequests() {
  const resource = useResource<{
    requests: {
      id: string;
      reason: string;
      createdAt: number;
      userId: string;
      nickname: string;
      email: string;
      response: string;
    }[];
  }>("/admin/account-requests");
  const [review, setReview] = useState<DeletionPreview | null>(null);
  const [response, setResponse] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  if (resource.loading) return <Loading />;
  if (!resource.data) return <Notice danger>{tr(resource.error)}</Notice>;
  return (
    <section>
      <p className="muted">
        {tr(
          "Review private requests, send an in-account response and check the deletion impact. Active tasks and unresolved payments block deletion.",
        )}
      </p>
      {error && <Notice danger>{tr(error)}</Notice>}
      {receipt && <Notice>{receipt}</Notice>}
      <div className="studio-tasks">
        {resource.data.requests.map((r) => (
          <article className="studio-task" key={r.id}>
            <p className="eyebrow">{tr("ACCOUNT DELETION REQUEST")}</p>
            <Author id={r.userId} name={r.nickname || "Storyteller"} />
            <p>{r.reason || tr("No additional note.")}</p>
            {r.response && (
              <p className="muted">
                {tr("Your response:")} {r.response}
              </p>
            )}
            <p className="fine-print">
              {tr("Private contact:")} {r.email}
              <br />
              {tr("Received")}{" "}
              {new Date(r.createdAt).toLocaleString(getLocale())}
              <br />
              {tr("Request ID:")} {r.id}
            </p>
            <Button
              kind="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                setReceipt("");
                try {
                  setReview(
                    await api<DeletionPreview>(
                      `/admin/account-requests/${r.id}/preview`,
                    ),
                  );
                  setResponse(r.response);
                  setConfirmed(false);
                  setConfirmation("");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {tr("Review request")}
            </Button>
          </article>
        ))}
      </div>
      {!resource.data.requests.length && (
        <p className="muted">{tr("No account requests awaiting review.")}</p>
      )}
      {review && (
        <Modal
          title={tr("Review account deletion")}
          onClose={() => {
            if (!busy) setReview(null);
          }}
        >
          <p>
            <strong>{review.request.nickname || tr("Storyteller")}</strong>
          </p>
          <p className="muted">
            {tr(
              "Deletion removes sign-in credentials, email, nickname, saved activity and submitted prompt text. Published scenes remain with anonymous credit; this person's stories pause. Required accounting and policy records remain. Other people's contributions are preserved.",
            )}
          </p>
          <p>
            {review.counts?.publishedScenes ?? 0} {tr("published scenes ·")}{" "}
            {review.counts?.ownedStories ?? 0} {tr("owned stories ·")}{" "}
            {review.counts?.retainedOrders ?? 0} {tr("retained order records")}
          </p>
          {review.blockers.map((message) => (
            <Notice key={message} danger>
              {tr(message)}
            </Notice>
          ))}
          <label className="field-label">
            {tr("Response visible to the requester")}
            <textarea
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              maxLength={1200}
              disabled={busy}
            />
          </label>
          <Button
            kind="secondary"
            disabled={busy || response.trim().length < 10}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api(
                  `/admin/account-requests/${review.request.id}/respond`,
                  "POST",
                  { response },
                );
                await resource.reload();
                setReceipt("Response saved to the person's account.");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {tr("Save response")}
          </Button>
          <p className="fine-print">
            {tr(
              "Before executing, review identifying details in retained videos, story text and references, and resolve any separate removal or legal retention needs. Private unpublished video files are queued for deletion; backup and provider copies follow the retention procedure.",
            )}
          </p>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy || !!review.blockers.length}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {tr(
              "I reviewed the retained content and retention needs. I understand that account deletion cannot be undone.",
            )}
          </label>
          <label className="field-label">
            {tr("Type DELETE ACCOUNT to confirm")}
            <input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              disabled={busy || !!review.blockers.length}
              autoComplete="off"
            />
          </label>
          {error && <Notice danger>{tr(error)}</Notice>}
          <Button
            disabled={
              busy ||
              !!review.blockers.length ||
              !confirmed ||
              confirmation !== "DELETE ACCOUNT"
            }
            busy={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const result = await api<{
                  receipt: { requestId: string; completedAt: number };
                }>(
                  `/admin/account-requests/${review.request.id}/execute`,
                  "POST",
                  {
                    userId: review.request.userId,
                    policyVersion: review.policyVersion,
                    reviewedContent: true,
                    confirm: confirmation,
                  },
                );
                setReceipt(
                  `Account deletion completed. Receipt: ${result.receipt.requestId}. Retain this receipt for the verified support response.`,
                );
                setReview(null);
                await resource.reload();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {tr("Delete account")}
          </Button>
        </Modal>
      )}
    </section>
  );
}
