import { useState } from "react";
import chinesePolicies from "./locales/policies.zh-CN.json";
import { t as tr, useLocale } from "./i18n";
import { Preferences } from "./Preferences";
import policies from "../shared/policies.json";
import { Link, Notice } from "./components";

export function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const [locale] = useLocale();
  const [showOriginal, setShowOriginal] = useState(false);
  const translated = locale === "zh-CN" && !showOriginal;
  const sections = translated ? chinesePolicies[kind] : policies[kind];
  return (
    <article className="page legal-page">
      <p className="eyebrow">{tr("A SHARED WORLD, CLEAR AGREEMENTS")}</p>
      <h1>
        {kind === "privacy" ? tr("Privacy policy") : tr("Terms of service")}
      </h1>
      <p className="legal-version">
        {tr("Version")} {policies.version} {tr("· Updated")}{" "}
        {policies.updatedAt}
        {policies.effectiveAt
          ? tr(" · Effective {0}", policies.effectiveAt)
          : tr(" · Not yet effective for public launch")}
      </p>
      {policies.status === "draft" && (
        <Notice>
          {tr(
            "Draft for review. Operator information and launch policies are being finalized. This is a development preview.",
          )}
        </Notice>
      )}
      <div className="legal-contact">
        <strong>{policies.contactName}</strong>
        <span>
          {tr("Intended service area:")} {tr(policies.serviceArea)}
        </span>
        {policies.contactEmail ? (
          <a href={`mailto:${policies.contactEmail}`}>
            {policies.contactEmail}
          </a>
        ) : (
          <span>{tr("Contact email: being prepared")}</span>
        )}
        <span className="fine-print">
          {tr("Operator:")}{" "}
          {policies.operatorName || tr("Identification pending in this draft")}
        </span>
      </div>
      {locale === "zh-CN" && (
        <div className="policy-translation-note">
          <p>
            {tr(
              "Chinese reading translation · The English version below is the original policy. This translation does not change its version, draft status or your acceptance records.",
            )}
          </p>
          <button
            type="button"
            className="text-button"
            onClick={() => setShowOriginal(!showOriginal)}
          >
            {showOriginal
              ? tr("Read Chinese translation")
              : tr("View English original")}
          </button>
        </div>
      )}
      <div lang={translated ? "zh-CN" : "en"}>
        <nav className="legal-toc" aria-label={tr("On this page")}>
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
      </div>
      <div className="legal-links">
        <Link to={kind === "privacy" ? "/terms" : "/privacy"}>
          {kind === "privacy" ? tr("Terms of service") : tr("Privacy policy")}
        </Link>
        <Link to="/account">{tr("Account & privacy requests")}</Link>
        <Link to="/discover">{tr("Return to stories")}</Link>
        <Preferences />
      </div>
    </article>
  );
}
