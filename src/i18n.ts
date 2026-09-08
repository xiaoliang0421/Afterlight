import { useSyncExternalStore } from "react";
import chinese from "./locales/zh-CN.json";

export type Locale = "en" | "zh-CN";
export const LOCALE_KEY = "talerelay.ui-language";
const catalog: Record<string, string> = chinese;
const listeners = new Set<() => void>();
function readLocale(): Locale {
  try {
    return typeof localStorage !== "undefined" &&
      localStorage.getItem(LOCALE_KEY) === "zh-CN"
      ? "zh-CN"
      : "en";
  } catch {
    return "en";
  }
}
let locale: Locale = readLocale();
export function getLocale() {
  return locale;
}
export function setLocale(value: Locale) {
  if (value !== "en" && value !== "zh-CN") return;
  try {
    localStorage.setItem(LOCALE_KEY, value);
  } catch {
    /* Keep the current-tab preference when storage is unavailable. */
  }
  if (locale === value) return;
  locale = value;
  for (const notify of listeners) notify();
}
function storageChanged(event: StorageEvent) {
  if (event.key !== LOCALE_KEY && event.key !== null) return;
  const next = readLocale();
  if (next !== locale) {
    locale = next;
    for (const notify of listeners) notify();
  }
}
function subscribe(notify: () => void) {
  listeners.add(notify);
  if (listeners.size === 1 && typeof window !== "undefined")
    window.addEventListener("storage", storageChanged);
  return () => {
    listeners.delete(notify);
    if (!listeners.size && typeof window !== "undefined")
      window.removeEventListener("storage", storageChanged);
  };
}
export function useLocale() {
  return [
    useSyncExternalStore(subscribe, getLocale, () => "en" as Locale),
    setLocale,
  ] as const;
}
export function translate(
  language: Locale,
  message: string,
  ...values: unknown[]
) {
  const template =
    language === "zh-CN"
      ? Object.hasOwn(catalog, message)
        ? catalog[message]
        : message
      : message;
  return template.replace(/\{(\d+)\}/g, (match, index) =>
    Number(index) < values.length ? String(values[Number(index)]) : match,
  );
}
// Call only for application-owned copy; story text and account names stay untouched.
export function t(message: string, ...values: unknown[]) {
  return translate(locale, message, ...values);
}
