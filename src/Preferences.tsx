import { useState } from "react";
import { Button, Modal } from "./components";
import { t as tr, useLocale } from "./i18n";

export function Preferences() {
  const [open, setOpen] = useState(false);
  const [locale, setLocale] = useLocale();
  return (
    <>
      <button
        type="button"
        className="preferences-link"
        onClick={() => setOpen(true)}
      >
        {tr("Preferences")}
      </button>
      {open && (
        <Modal title={tr("Reading preferences")} onClose={() => setOpen(false)}>
          <fieldset className="language-preferences">
            <legend>{tr("Interface language")}</legend>
            <div className="language-options">
              <Button
                type="button"
                kind="secondary"
                aria-pressed={locale === "en"}
                lang="en"
                onClick={() => setLocale("en")}
              >
                English
              </Button>
              <Button
                type="button"
                kind="secondary"
                aria-pressed={locale === "zh-CN"}
                lang="zh-CN"
                onClick={() => setLocale("zh-CN")}
              >
                简体中文
              </Button>
            </div>
          </fieldset>
          <p className="fine-print">
            {tr(
              "Saved on this device. Story text, original submissions and video dialogue keep their original language.",
            )}
          </p>
          <Button type="button" onClick={() => setOpen(false)}>
            {tr("Done")}
          </Button>
        </Modal>
      )}
    </>
  );
}
