"use client";

import { useState } from "react";
import { achievementName } from "@/lib/achievements";
import { useI18n } from "@/lib/use-locale";
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
      className={cx("brand-panel rounded-card bg-surface", !flush && "p-4", className)}
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
        <h2 className="mono-label text-hint">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-hint">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

// Primary is the landing's blue CTA, secondary its outlined one.
const BUTTON_VARIANTS = {
  primary: "bg-button text-accent-fg",
  secondary: "border border-[color:var(--control-border)] bg-transparent text-fg",
  ghost: "text-link",
  danger: "border border-[color:color-mix(in_srgb,var(--danger)_45%,transparent)] text-danger",
};

export function Button({ variant = "primary", size = "md", busy = false, className, children, disabled, ...rest }) {
  return (
    <button
      className={cx(
        "inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold transition",
        "active:scale-[0.98] active:opacity-85 disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" ? "min-h-9 px-3.5 py-1.5 text-center text-[14px] leading-tight" : "h-12 px-5 text-[15px]",
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

// A tag like the landing's rarity labels: a hairline frame, square-ish corners.
// Neutral by default: blue is for things that can be tapped.
export function Chip({ tone = "neutral", icon, children }) {
  const tones = {
    accent: "border-[color:color-mix(in_srgb,var(--accent)_40%,transparent)] text-accent",
    success: "border-[color:color-mix(in_srgb,var(--success)_45%,transparent)] text-success",
    danger: "border-[color:color-mix(in_srgb,var(--danger)_45%,transparent)] text-danger",
    gold: "border-[color:color-mix(in_srgb,var(--gold)_55%,transparent)] text-[color:var(--gold-text)]",
    neutral: "border-[color:var(--control-border)] text-hint",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-[7px] border bg-surface px-2 py-[3px] text-xs font-medium",
        tones[tone],
      )}
    >
      {icon}
      {children}
    </span>
  );
}

// Inline status line under an action (info / ok / err). Errors usually come
// from the API in English: known ones are shown in the app's language. A
// notice kept in state outlives a switch of language (the TopBar's), so its
// own text is a function of the screen's i18n helpers (useI18n), called when
// the notice is drawn: bilingual(ru, en), or (t) => t.L(...) when the text
// formats numbers. A plain string is shown as is.
export function Notice({ notice }) {
  const t = useI18n();
  if (!notice) return null;
  // Information reads like the landing's dashed "Where the TON goes" note;
  // outcomes keep their color.
  const map = {
    ok: { cls: "tint-success text-success", Icon: Check },
    err: { cls: "tint-danger text-danger", Icon: Alert },
    info: { cls: "border border-dashed border-[color:var(--control-border)] text-fg", Icon: Info },
  };
  const { cls, Icon } = map[notice.kind] || map.info;
  return (
    <div className={cx("flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] leading-snug", cls)} role="status">
      <Icon className="mt-px h-4 w-4 shrink-0" />
      <span>{typeof notice.text === "function" ? notice.text(t) : notice.kind === "err" ? t.error(notice.text) : notice.text}</span>
    </div>
  );
}

// A notice text in both languages, picked when the notice is drawn (see
// Notice): setNotice({ kind: "ok", text: bilingual("Сохранено.", "Saved.") }).
export function bilingual(ru, en) {
  return ({ L }) => L(ru, en);
}

export function Skeleton({ className }) {
  return <div className={cx("skeleton rounded-lg", className)} />;
}

export function EmptyState({ icon, title, children }) {
  return (
    <Card className="flex flex-col items-center gap-2 py-8 text-center">
        {icon && (
        <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed border-[color:var(--control-border)] text-hint">
          {icon}
        </div>
      )}
      <p className="brand-heading text-[17px]">{title}</p>
      {children && <p className="max-w-[18rem] text-sm text-hint text-balance">{children}</p>}
    </Card>
  );
}

// Deterministic tinted avatar with the initial of a chat or a member.
const AVATAR_HUES = [210, 262, 330, 20, 145, 190, 40, 290];
export function LetterAvatar({ title, id, size = 44 }) {
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
        // muted, to sit on paper rather than glow on it
        background: `linear-gradient(135deg, hsl(${hue} 38% 58%), hsl(${hue + 20} 34% 44%))`,
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
  const { locale } = useI18n();
  const [broken, setBroken] = useState(false);
  const file = encodeURIComponent(String(type || "").toLowerCase());
  return (
    <div className={cx("stage overflow-hidden rounded-[14px] border border-[color:var(--separator)]", className)}>
      {broken ? (
        <div className="flex h-full w-full items-center justify-center text-3xl">
          🏅
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/achievements/${collection}/${file}.webp`}
          alt={achievementName(type, locale)}
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

// iOS-style segmented control; `format` renders each option's label.
export function Segmented({ options, value, onChange, format }) {
  return (
    <div className="flex rounded-xl border border-[color:var(--separator)] bg-bg p-1">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={cx(
            "h-9 flex-1 rounded-lg text-[14px] font-semibold transition",
            value === option ? "brand-panel bg-surface text-fg" : "text-hint",
          )}
          onClick={() => onChange(option)}
        >
          {format(option)}
        </button>
      ))}
    </div>
  );
}
