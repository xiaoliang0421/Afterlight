import { getLocale, t as tr } from "./i18n";
type Turnstile = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
let siteKey: string | undefined;
let scriptPromise: Promise<void> | undefined;
export function configureVerification(key: string) {
  siteKey = key;
}
function loadWidget() {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise)
    scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      const timeout = window.setTimeout(() => fail(), 15000);
      const fail = () => {
        clearTimeout(timeout);
        script.remove();
        scriptPromise = undefined;
        reject(
          new Error(
            "The security check could not load. Check your connection and try again.",
          ),
        );
      };
      script.onerror = fail;
      script.onload = () => {
        clearTimeout(timeout);
        if (window.turnstile) resolve();
        else fail();
      };
      document.head.appendChild(script);
    });
  return scriptPromise;
}
export async function humanToken(
  action: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (signal?.aborted) throw new Error("Request cancelled.");
  if (siteKey === undefined) {
    const r = await fetch("/api/bootstrap", {
      credentials: "same-origin",
      signal,
    });
    const data = (await r.json()) as { config?: { turnstileSiteKey?: string } };
    if (!r.ok || typeof data.config?.turnstileSiteKey !== "string")
      throw new Error("Security configuration is unavailable.");
    siteKey = data.config.turnstileSiteKey;
  }
  if (!siteKey) return null; // The server decides whether local bypass is allowed.
  await loadWidget();
  if (signal?.aborted) throw new Error("Request cancelled.");
  return new Promise((resolve, reject) => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = document.createElement("dialog");
    dialog.className = "human-verification";
    const title = document.createElement("h2");
    title.textContent = tr("A quick security check");
    title.id = `verify-${crypto.randomUUID()}`;
    dialog.setAttribute("aria-labelledby", title.id);
    const copy = document.createElement("p");
    copy.textContent = tr(
      "This helps keep community creation available for everyone.",
    );
    const container = document.createElement("div");
    const cancel = document.createElement("button");
    cancel.textContent = tr("Cancel");
    cancel.type = "button";
    for (const child of [title, copy, container, cancel])
      dialog.appendChild(child);
    document.body.appendChild(dialog);
    dialog.showModal();
    let widget: string | undefined,
      settled = false;
    const finish = (token?: string, message?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (widget !== undefined) window.turnstile?.remove(widget);
      dialog.close();
      dialog.remove();
      previousFocus?.focus();
      if (token) resolve(token);
      else
        reject(
          new Error(
            message ?? "Security check cancelled. This action was not sent.",
          ),
        );
    };
    const abort = () => finish();
    const timeout = window.setTimeout(
      () =>
        finish(undefined, "The security check timed out. Please try again."),
      120000,
    );
    cancel.onclick = abort;
    dialog.oncancel = (e) => {
      e.preventDefault();
      abort();
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      widget = window.turnstile!.render(container, {
        sitekey: siteKey,
        action,
        theme: "dark",
        language: getLocale(),
        callback: (token: string) => finish(token),
        "error-callback": () => {
          finish(undefined, "The security check failed. Please try again.");
          return true;
        },
        "expired-callback": () =>
          finish(undefined, "The security check expired. Please try again."),
        "timeout-callback": () =>
          finish(undefined, "The security check timed out. Please try again."),
      });
    } catch {
      finish(
        undefined,
        "The security check could not start. Please try again.",
      );
    }
  });
}
