import { t as tr } from "./i18n";
import {
  useEffect,
  useRef,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { ArrowUpRight, Check, LoaderCircle, X } from "lucide-react";
import { navigate } from "./api";
import type { TaskState } from "../shared/domain";

export function Link({
  to,
  children,
  className = "",
  onClick,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to);
        onClick?.();
      }}
    >
      {children}
    </a>
  );
}
export function Button({
  children,
  busy,
  kind = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  kind?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`button ${kind} ${props.className ?? ""}`}
    >
      {busy && <LoaderCircle size={16} className="spin" />}
      {children}
    </button>
  );
}
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const color = [...name].reduce((n, c) => n + c.charCodeAt(0), 0) % 4;
  return (
    <span
      aria-hidden="true"
      className={`avatar tone-${color}`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((s) => s[0])
        .join("")
        .toUpperCase() || "?"}
    </span>
  );
}
export function Author({
  id,
  name,
  label,
  compact,
}: {
  id: string;
  name: string;
  label?: string;
  compact?: boolean;
}) {
  return (
    <Link
      to={`/people/${encodeURIComponent(id)}`}
      className={`author ${compact ? "compact" : ""}`}
    >
      <Avatar name={name} size={compact ? 24 : 32} />
      <span>
        {label && <small>{label}</small>}
        <strong>{name}</strong>
      </span>
      {!compact && <ArrowUpRight size={14} />}
    </Link>
  );
}
export function Modal({
  title,
  eyebrow,
  onClose,
  children,
  wide = false,
  dismissible = true,
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      el?.close();
      document.body.style.overflow = before;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && dismissible) onClose();
      }}
    >
      <div className="modal-inner">
        {dismissible && (
          <button
            aria-label={tr("Close dialog")}
            className="icon-button modal-close"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        )}
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
export function Notice({
  children,
  danger = false,
}: {
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <div
      className={`notice ${danger ? "danger-note" : ""}`}
      role={danger ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={22} />
      <span>{tr("Bringing the story into focus…")}</span>
    </div>
  );
}
export const statusLabels: Record<TaskState, string> = {
  Draft: "Saved idea",
  NeedsReview: "Your review needed",
  Queued: "In the queue",
  Preparing: "Checking continuity",
  Generating: "Generating scene",
  Checking: "Checking the video",
  NeedsModeration: "Studio review",
  Packaging: "Preparing playback",
  Published: "In the story",
  Cancelled: "Withdrawn",
  Failed: "Credit returned",
  ReconciliationNeeded: "Studio attention needed",
};
export function Status({ state }: { state: TaskState }) {
  return (
    <span className={`status status-${state.toLowerCase()}`}>
      {state === "Published" ? (
        <Check size={12} />
      ) : ["Preparing", "Generating", "Checking", "Packaging"].includes(
          state,
        ) ? (
        <LoaderCircle size={12} className="spin" aria-hidden="true" />
      ) : (
        <i />
      )}
      {tr(statusLabels[state])}
    </span>
  );
}
