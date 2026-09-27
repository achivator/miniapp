"use client";

import { useState } from "react";
import { Alert, Check, Info } from "./icons";

export function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

export function Spinner({ className = "h-4 w-4" }) {
  return (
    <svg className={cx("animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Card({ className, flush = false, children, ...rest }) {
  return (
    <div
      className={cx("rounded-card bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)]", !flush && "p-4", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function SectionHeader({ title, hint, action }) {
  return (
    <div className="flex items-end justify-between px-1">
      <div>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-hint">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-hint">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

const BUTTON_VARIANTS = {
  primary: "bg-accent text-accent-fg",
  secondary: "tint-accent text-accent",
  ghost: "text-link",
  danger: "tint-danger text-danger",
};

export function Button({ variant = "primary", size = "md", busy = false, className, children, disabled, ...rest }) {
  return (
    <button
      className={cx(
        "inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold transition",
        "active:scale-[0.98] active:opacity-85 disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" ? "h-9 px-3.5 text-[14px]" : "h-12 px-5 text-[15px]",
        BUTTON_VARIANTS[variant],
        className,
      )}
      disabled={disabled || busy}
      {...rest}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Chip({ tone = "accent", icon, children }) {
  const tones = {
    accent: "tint-accent text-accent",
    success: "tint-success text-success",
    danger: "tint-danger text-danger",
    gold: "tint-gold text-[color:var(--gold-text)]",
    neutral: "bg-bg text-hint",
  };
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium", tones[tone])}>
      {icon}
      {children}
    </span>
  );
}

// Inline status line under an action (info / ok / err).
export function Notice({ notice }) {
  if (!notice) return null;
  const map = {
    ok: { cls: "tint-success text-success", Icon: Check },
    err: { cls: "tint-danger text-danger", Icon: Alert },
    info: { cls: "tint-accent text-accent", Icon: Info },
  };
  const { cls, Icon } = map[notice.kind] || map.info;
  return (
    <div className={cx("flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] leading-snug", cls)} role="status">
      <Icon className="mt-px h-4 w-4 shrink-0" />
      <span>{notice.text}</span>
    </div>
  );
}

export function Skeleton({ className }) {
  return <div className={cx("skeleton rounded-lg", className)} />;
}

export function EmptyState({ icon, title, children }) {
  return (
    <Card className="flex flex-col items-center gap-2 py-8 text-center">
      {icon && <div className="tint-accent mb-1 flex h-12 w-12 items-center justify-center rounded-2xl text-accent">{icon}</div>}
      <p className="font-semibold">{title}</p>
      {children && <p className="max-w-[18rem] text-sm text-hint text-balance">{children}</p>}
    </Card>
  );
}

// Deterministic tinted avatar with the chat's initial.
const AVATAR_HUES = [210, 262, 330, 20, 145, 190, 40, 290];
export function ChatAvatar({ title, id, size = 44 }) {
  const seed = String(id ?? title ?? "");
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = AVATAR_HUES[h % AVATAR_HUES.length];
  const letter = (title || "#").trim().charAt(0).toUpperCase() || "#";
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `linear-gradient(135deg, hsl(${hue} 80% 62%), hsl(${hue + 25} 72% 50%))`,
      }}
      aria-hidden="true"
    >
      {letter}
    </div>
  );
}

// Pixel-art medal from /public, with a neutral fallback for types that have
// no artwork yet.
export function AchievementArt({ type, collection = "v1", className }) {
  const [broken, setBroken] = useState(false);
  const file = encodeURIComponent(String(type || "").toLowerCase());
  return (
    <div className={cx("overflow-hidden rounded-2xl bg-white ring-1 ring-black/5", className)}>
      {broken ? (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-amber-100 to-amber-300 text-3xl">
          🏅
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/achievements/${collection}/${file}.webp`}
          alt={type}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setBroken(true)}
        />
      )}
    </div>
  );
}

export function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 text-[15px]">
      <span className="text-hint">{label}</span>
      <span className="min-w-0 truncate text-right font-medium tabular">{children}</span>
    </div>
  );
}

export function titleCase(text) {
  return String(text || "").replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

// iOS-style segmented control; `format` renders each option's label.
export function Segmented({ options, value, onChange, format }) {
  return (
    <div className="flex rounded-xl bg-bg p-1">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={cx(
            "h-9 flex-1 rounded-lg text-[14px] font-semibold transition",
            value === option ? "bg-surface text-fg shadow-sm" : "text-hint",
          )}
          onClick={() => onChange(option)}
        >
          {format(option)}
        </button>
      ))}
    </div>
  );
}
