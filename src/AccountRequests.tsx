import { getLocale, t as tr } from "./i18n";
import { useState } from "react";
import { api, useResource } from "./api";
import { Button, Modal, Notice } from "./components";
export function AccountRequests() {
  const resource = useResource<{
    requests: {
      id: string;
      status: string;
      response: string;
      createdAt: number;
    }[];
  }>("/account/requests");
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = resource.data?.requests.find((r) => r.status === "open");
  return (
    <section className="form-panel account-request-panel">
      <h2>{tr("Account & privacy requests")}</h2>
      <p className="muted">
        {tr(
          "You can request account deletion here. The studio will review unfinished scenes, credit records and the attribution of shared stories before completing the request.",
        )}
      </p>
      {pending ? (
        <>
          <Notice>
            {tr("Your deletion request was received on")}{" "}
            {new Date(pending.createdAt).toLocaleDateString(getLocale())}
            {tr(". It is awaiting review.")}
          </Notice>
          {pending.response && <Notice>{pending.response}</Notice>}
          <Button
            kind="secondary"
            onClick={async () => {
              try {
                await api(`/account/requests/${pending.id}/cancel`, "POST", {});
                await resource.reload();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {tr("Withdraw request")}
          </Button>
        </>
      ) : (
        <Button kind="secondary" onClick={() => setOpen(true)}>
          {tr("Request account deletion")}
        </Button>
      )}
      {error && <Notice danger>{tr(error)}</Notice>}
      {open && (
        <Modal
          title={tr("Request account deletion")}
          onClose={() => setOpen(false)}
        >
          <p>
            {tr(
              "This submits a request to the studio. Your account and published scenes remain available during review. You can withdraw the request from this page.",
            )}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await api("/account/requests", "POST", {
                  kind: "deletion",
                  reason,
                });
                await resource.reload();
                setOpen(false);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field-label">
              {tr("Anything we should know? · optional")}
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={1200}
              />
            </label>
            {error && <Notice danger>{tr(error)}</Notice>}
            <Button busy={busy} type="submit">
              {tr("Submit deletion request")}
            </Button>
          </form>
        </Modal>
      )}
    </section>
  );
}
