import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { api } from "./api";
import { useApp } from "./context";
import { Button, Notice } from "./components";
import { collectAccountExport } from "./account-export";

export function AccountExport() {
  const { boot } = useApp();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const controller = useRef<AbortController | null>(null);
  const downloadUrl = useRef<string | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    },
    [boot.user?.id],
  );
  return (
    <section className="form-panel account-request-panel" id="account-data">
      <h2>A copy of your account</h2>
      <p className="muted">
        Download your profile, story and scene text, ideas, credits, orders,
        saved stories, viewing progress and agreement records in one JSON file.
        Videos and reference files are not included.
      </p>
      <p className="field-help">
        The file includes your private email and account activity. Share it
        carefully.
      </p>
      {error && <Notice danger>{error}</Notice>}
      <p role="status" aria-live="polite" className="field-help">
        {status}
      </p>
      <Button
        kind="secondary"
        busy={busy}
        onClick={async () => {
          if (controller.current) return;
          const current = new AbortController();
          controller.current = current;
          setBusy(true);
          setError("");
          setStatus("Preparing your download…");
          try {
            const blob = await collectAccountExport(
              (path, body, signal) => api(path, "POST", body, signal),
              current.signal,
              (_section, count) =>
                setStatus(`Collected ${count.toLocaleString("en")} records…`),
            );
            current.signal.throwIfAborted();
            if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
            downloadUrl.current = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = downloadUrl.current;
            link.download = `talerelay-account-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setStatus("Your file is ready. Check your browser downloads.");
          } catch (e) {
            if (current.signal.aborted) {
              if (controller.current === current)
                setStatus("Download cancelled. No partial file was saved.");
            } else
              setError(
                e instanceof Error
                  ? e.message
                  : "Unable to download your records. Please try again.",
              );
          } finally {
            if (controller.current === current) {
              controller.current = null;
              setBusy(false);
            }
          }
        }}
      >
        <Download size={16} /> Download my data
      </Button>
      {busy && (
        <Button kind="ghost" onClick={() => controller.current?.abort()}>
          Cancel download
        </Button>
      )}
    </section>
  );
}
