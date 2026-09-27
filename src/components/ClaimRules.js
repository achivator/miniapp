"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client-api";
import { Button, Card, Chip, Notice, SectionHeader, Segmented, cx } from "./ui";
import { useHaptic } from "./AppShell";

const MATURATION_OPTIONS = [0, 1, 3, 7, 14];
// Display order Monday-first; values are UTC getUTCDay() numbers.
const WEEKDAYS = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [0, "Sun"],
];

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-7 w-12 shrink-0 rounded-full transition",
        checked && "bg-accent",
      )}
      style={checked ? undefined : { background: "color-mix(in srgb, var(--hint) 35%, transparent)" }}
    >
      <span
        className={cx(
          "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all",
          checked ? "left-[22px]" : "left-0.5",
        )}
      />
    </button>
  );
}

function toDateInput(epochSec) {
  return epochSec ? new Date(epochSec * 1000).toISOString().slice(0, 10) : "";
}

// Off-chain claim rules of a chat (the backend enforces them when it signs
// claim vouchers): maturation period, weekly claim window, vacation pause.
export function ClaimRules({ chatId, initDataRaw }) {
  const haptic = useHaptic();
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    if (!initDataRaw) return;
    try {
      const res = await apiFetch(`/api/claim-settings?chatId=${chatId}`, { initDataRaw });
      setSaved(res.settings);
      setDraft(res.settings);
    } catch (e) {
      setNotice({ kind: "err", text: e.message });
    }
  }, [chatId, initDataRaw]);

  useEffect(() => {
    load();
  }, [load]);

  if (!draft) return null;

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const toggleDay = (day) =>
    set({
      claim_days: draft.claim_days.includes(day)
        ? draft.claim_days.filter((d) => d !== day)
        : [...draft.claim_days, day].sort(),
    });

  async function save() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await apiFetch("/api/claim-settings", {
        method: "POST",
        initDataRaw,
        body: { chatId, settings: draft },
      });
      setSaved(res.settings);
      setDraft(res.settings);
      haptic("success");
      setNotice({ kind: "ok", text: "Claim rules saved." });
    } catch (e) {
      haptic("error");
      setNotice({ kind: "err", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2.5">
      <SectionHeader title="Claim rules" hint="Free to change — the bot stops signing claims that break them." />
      <Card className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <p className="font-semibold">New points mature in</p>
            {draft.maturation_days > 0 && <Chip tone="accent">anti-farming on</Chip>}
          </div>
          <Segmented
            options={MATURATION_OPTIONS}
            value={draft.maturation_days}
            onChange={(v) => set({ maturation_days: v })}
            format={(v) => (v === 0 ? "Now" : `${v}d`)}
          />
          <p className="text-[13px] leading-snug text-hint">
            Points from reactions and /reward become claimable only after this delay, so points farmed with friends
            can&apos;t be cashed out before you notice.
          </p>
        </div>

        <div className="space-y-2">
          <p className="font-semibold">Claim days</p>
          <div className="grid grid-cols-7 gap-1.5">
            {WEEKDAYS.map(([day, label]) => {
              const on = draft.claim_days.length === 0 || draft.claim_days.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={cx(
                    "h-10 rounded-xl text-[13px] font-semibold transition",
                    draft.claim_days.includes(day) ? "bg-accent text-accent-fg" : on ? "tint-accent text-accent" : "bg-bg text-hint",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="text-[13px] leading-snug text-hint">
            {draft.claim_days.length === 0
              ? "Every day. Pick days to open claims only then (UTC)."
              : "Claims open only on the highlighted days (UTC)."}
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold">Pause claims</p>
              <p className="text-[13px] leading-snug text-hint">Going on vacation? Nobody can claim until you&apos;re back.</p>
            </div>
            <Toggle
              label="Pause claims"
              checked={draft.paused}
              onChange={(paused) => set({ paused, paused_until: paused ? draft.paused_until : null })}
            />
          </div>
          {draft.paused && (
            <label className="flex h-12 items-center justify-between gap-3 rounded-xl bg-bg px-3.5">
              <span className="text-[14px] text-hint">Resume automatically</span>
              <input
                type="date"
                className="bg-transparent text-right text-[15px] font-medium outline-none"
                min={toDateInput(Math.floor(Date.now() / 1000) + 86400)}
                value={toDateInput(draft.paused_until)}
                onChange={(e) =>
                  set({ paused_until: e.target.value ? Math.floor(Date.parse(`${e.target.value}T00:00:00Z`) / 1000) : null })
                }
              />
            </label>
          )}
        </div>

        <Button variant="secondary" className="w-full" busy={busy} disabled={!dirty} onClick={save}>
          Save rules
        </Button>
        <Notice notice={notice} />
      </Card>
    </section>
  );
}
