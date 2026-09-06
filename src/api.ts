import { useCallback, useEffect, useRef, useState } from "react";
import { creationAction } from "../shared/protection";
import { configureVerification, humanToken } from "./humanVerification";
export class ApiError extends Error {
  constructor(
    message: string,
    public code = "request_failed",
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  data?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const action = creationAction(path, method);
  const token = action ? await humanToken(action, signal) : null;
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { "X-Turnstile-Token": token } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal,
  });
  const body = (await response.json().catch(() => null)) as
    | (T & {
        error?: { message?: string; code?: string };
      })
    | null;
  if (!body)
    throw new ApiError(
      "The server is temporarily unavailable. Please try again.",
      "server_unavailable",
    );
  if (!response.ok)
    throw new ApiError(
      body.error?.message ?? "The request could not be completed.",
      body.error?.code,
    );
  if (path === "/bootstrap") {
    const config = (body as { config?: { turnstileSiteKey?: string } }).config;
    if (typeof config?.turnstileSiteKey === "string")
      configureVerification(config.turnstileSiteKey);
  }
  return body as T;
}
export function navigate(path: string, replace = false) {
  window.history[replace ? "replaceState" : "pushState"]({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0, behavior: "instant" });
}
export function useLocation() {
  const [path, setPath] = useState(
    window.location.pathname + window.location.search,
  );
  useEffect(() => {
    const update = () =>
      setPath(window.location.pathname + window.location.search);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return path;
}
export function useResource<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(!!path);
  const epoch = useRef(0);
  const reload = useCallback(async () => {
    if (!path) return;
    const ticket = ++epoch.current;
    try {
      const value = await api<T>(path);
      if (ticket === epoch.current) {
        setData(value);
        setError("");
      }
    } catch (err) {
      if (ticket === epoch.current)
        setError(err instanceof Error ? err.message : "Unable to load.");
    } finally {
      if (ticket === epoch.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    setData(null);
    setError("");
    setLoading(!!path);
    void reload();
    return () => {
      epoch.current++;
    };
  }, [reload, ...deps]);
  return { data, error, loading, reload, setData };
}
