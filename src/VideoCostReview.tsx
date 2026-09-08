import { t as tr } from "./i18n";
import { useState } from "react";
import { api } from "./api";
import { Button, Modal, Notice } from "./components";

export function VideoCostReview({
  task,
  close,
  done,
}: {
  task: {
    id: string;
    providerRequestId: string | null;
    recordedCostCents: number;
    reservedCents: number;
  };
  close: () => void;
  done: () => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [evidence, setEvidence] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title={tr("Check the video charge")}
      onClose={close}
      dismissible={!busy}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
            setError("Enter a USD amount with up to two decimal places.");
            return;
          }
          setBusy(true);
          try {
            await api(`/admin/tasks/${task.id}/cost`, "POST", {
              providerRequestId: task.providerRequestId,
              recordedCostCents: Math.round(Number(amount) * 100),
              evidence,
              reviewed,
            });
            await done();
            close();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          {tr(
            "Match this request to the provider’s completed video charge before recording its cost.",
          )}
        </p>
        <p className="field-label">
          {tr("Provider request")} <code>{task.providerRequestId}</code>
        </p>
        <p>
          {tr("Recorded ceiling: $")}
          {(task.recordedCostCents / 100).toFixed(2)}
          {tr(". The $")}
          {(task.reservedCents / 100).toFixed(2)}{" "}
          {tr(
            "reservation stays held until the scene is approved or rejected.",
          )}
        </p>
        <label className="field-label">
          {tr("Verified video charge · USD")}
          <input
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            disabled={busy}
          />
        </label>
        <p className="fine-print">
          {tr(
            "Round fractional cents up. Include only this video request; speech checks and story planning are recorded separately. Charges above the reservation require an investigation.",
          )}
        </p>
        <label className="field-label">
          {tr("Billing evidence")}
          <textarea
            required
            minLength={10}
            maxLength={600}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder={tr(
              "Billing record, date and verified amount. Do not paste credentials or signed media links.",
            )}
            disabled={busy}
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
            disabled={busy}
          />
          {tr("I checked the final provider charge for this exact request.")}
        </label>
        {error && <Notice danger>{tr(error)}</Notice>}
        <Button
          type="submit"
          busy={busy}
          disabled={!reviewed || !amount || evidence.trim().length < 10}
        >
          {tr("Record verified cost")}
        </Button>
      </form>
    </Modal>
  );
}
