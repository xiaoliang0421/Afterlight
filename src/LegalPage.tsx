import policies from "../shared/policies.json";
import { Link, Notice } from "./components";

export function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const sections = policies[kind];
  return (
    <article className="page legal-page">
      <p className="eyebrow">A SHARED WORLD, CLEAR AGREEMENTS</p>
      <h1>{kind === "privacy" ? "Privacy policy" : "Terms of service"}</h1>
      <p className="legal-version">
        Version {policies.version} · Updated {policies.updatedAt}
        {policies.effectiveAt
          ? ` · Effective ${policies.effectiveAt}`
          : " · Not yet effective for public launch"}
      </p>
      {policies.status === "draft" && (
        <Notice>
          Draft for review. Operator information and launch policies are being
          finalized. This is a development preview.
        </Notice>
      )}
      <div className="legal-contact">
        <strong>{policies.contactName}</strong>
        <span>Intended service area: {policies.serviceArea}</span>
        {policies.contactEmail ? (
          <a href={`mailto:${policies.contactEmail}`}>
            {policies.contactEmail}
          </a>
        ) : (
          <span>Contact email: being prepared</span>
        )}
        <span className="fine-print">
          Operator:{" "}
          {policies.operatorName || "Identification pending in this draft"}
        </span>
      </div>
      <nav className="legal-toc" aria-label="On this page">
        {sections.map((section, i) => (
          <a key={section.id} href={`#${section.id}`}>
            {i + 1}. {section.title}
          </a>
        ))}
      </nav>
      {sections.map((section, i) => (
        <section key={section.id} id={section.id}>
          <h2>
            {i + 1}. {section.title}
          </h2>
          {section.paragraphs.map((paragraph, n) => (
            <p key={n}>{paragraph}</p>
          ))}
        </section>
      ))}
      <div className="legal-links">
        <Link to={kind === "privacy" ? "/terms" : "/privacy"}>
          {kind === "privacy" ? "Terms of service" : "Privacy policy"}
        </Link>
        <Link to="/account">Account & privacy requests</Link>
        <Link to="/discover">Return to stories</Link>
      </div>
    </article>
  );
}
