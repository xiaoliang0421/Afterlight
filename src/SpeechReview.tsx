import { t as tr } from "./i18n";
import { useState } from "react";
import type { SpeechAssessment } from "../shared/speech";
import { api, useResource } from "./api";
import { Button, Notice } from "./components";
type Check = {
  status: string;
  requestId: string | null;
  failureCode: string;
  result: SpeechAssessment | null;
  updatedAt: number;
};
export function SpeechReview({
  taskId,
  onCaptions,
}: {
  taskId: string;
  onCaptions: (value: string) => void;
}) {
  const resource = useResource<{ check: Check | null }>(
    `/admin/tasks/${taskId}/speech`,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [terminal, setTerminal] = useState(false);
  const check = resource.data?.check;
  const act = async (action: string) => {
    setBusy(true);
    setError("");
    try {
      await api(
        `/admin/tasks/${taskId}/speech/${action}`,
        "POST",
        action === "close" ? { providerTerminalVerified: terminal, note } : {},
      );
      await resource.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="advanced-review"
      aria-label={tr("Automatic speech review")}
    >
      <h3>{tr("Speech & caption check")}</h3>
      <p className="fine-print">
        {tr(
          "Independent language detection is a review aid. Listen to the entire clip and check readable text separately; no automated result publishes a scene.",
        )}
      </p>
      {resource.loading ? (
        <p>{tr("Loading speech check…")}</p>
      ) : !check ? (
        <>
          <p>
            {tr(
              "No automatic transcript is available. You can review the audio manually or run one speech check.",
            )}
          </p>
          <Button
            kind="secondary"
            busy={busy}
            onClick={() => void act("start")}
          >
            {tr("Check speech · up to $0.10 platform budget")}
          </Button>
        </>
      ) : (
        <>
          <p>
            {check.status === "completed"
              ? check.result?.verdict === "english-likely"
                ? tr("English detected — review still required.")
                : tr("Language or timing needs review.")
              : tr("Speech check: {0}.", check.status)}
          </p>
          {check.result && (
            <>
              <p>
                {check.result.language} ·{" "}
                {Math.round(check.result.confidence * 100)}
                {tr("% language confidence")}
              </p>
              <p>{check.result.transcript || tr("No transcript returned.")}</p>
              {check.result.issues.map((issue) => (
                <Notice danger key={issue}>
                  {issue}
                </Notice>
              ))}
              {check.result.captions.trim() !== "WEBVTT" && (
                <Button
                  kind="secondary"
                  onClick={() => onCaptions(check.result!.captions)}
                >
                  {tr("Use caption draft for review")}
                </Button>
              )}
            </>
          )}
          {check.status === "queued" && (
            <Button
              kind="secondary"
              busy={busy}
              onClick={() => void act("refresh")}
            >
              {tr("Refresh existing check")}
            </Button>
          )}
          {["uncertain", "queued", "failed"].includes(check.status) && (
            <details>
              <summary>{tr("Resolve the existing speech attempt")}</summary>
              <p className="fine-print">
                {tr(
                  "Verify the request has stopped with the provider before closing it. Its $0.10 cost ceiling remains counted. Closing never resubmits or regenerates the clip.",
                )}
              </p>
              <p>
                {tr("Provider request:")}{" "}
                {check.requestId ||
                  tr(
                    "Submission response was not recorded; investigate the provider request history.",
                  )}
              </p>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={terminal}
                  onChange={(e) => setTerminal(e.target.checked)}
                />
                {tr(
                  "The provider attempt is terminal and its cost is within the recorded ceiling.",
                )}
              </label>
              <label className="field-label">
                {tr("Verification notes")}
                <textarea
                  value={note}
                  maxLength={1000}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <Button
                kind="secondary"
                busy={busy}
                disabled={!terminal || note.trim().length < 20}
                onClick={() => void act("close")}
              >
                {tr("Close this check after verification")}
              </Button>
            </details>
          )}
        </>
      )}
      {(error || resource.error) && (
        <Notice danger>{tr(error || resource.error)}</Notice>
      )}
    </section>
  );
}
