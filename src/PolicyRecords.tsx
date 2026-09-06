import { useResource } from "./api";
import { Link, Notice } from "./components";
export function PolicyRecords() {
  const result = useResource<{
    records: { version: string; acceptedAt: number }[];
  }>("/account/policies");
  return (
    <section className="form-panel">
      <h2>Your agreements</h2>
      <p className="muted">
        Your acceptance records refer to the exact policy text shown at that
        time. Privacy acknowledgment is separate from any optional marketing
        choice.
      </p>
      {result.error && <Notice danger>{result.error}</Notice>}
      {result.data?.records.length === 0 && (
        <p className="muted">No policy acceptance has been recorded.</p>
      )}
      {result.data?.records.map((record) => (
        <p key={record.version}>
          <strong>{record.version}</strong> ·{" "}
          {new Date(record.acceptedAt).toLocaleString("en")}
          <br />
          <a
            className="text-button"
            href={`/api/account/policies/${encodeURIComponent(record.version)}?download=1`}
          >
            Download the accepted policy text
          </a>
        </p>
      ))}
      <div className="legal-links">
        <Link to="/terms">Current terms</Link>
        <Link to="/privacy">Current privacy policy</Link>
      </div>
    </section>
  );
}
