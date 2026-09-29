"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client-api";
import { formatDate } from "@/lib/format";
import { compareDecimal, normalizePointPrice, priceFitsDecimals } from "@/lib/point-price";
import { formatUnits, pointsToJettons } from "@/lib/ton/amounts";
import { Button, Card, Chip, Notice, SectionHeader } from "./ui";
import { useHaptic } from "./AppShell";

const EXAMPLE_POINTS = 100;
const DAY_MS = 86400 * 1000;

// A precise moment in the viewer's time zone, with the zone named: the
// creator and the members may be in different ones.
function momentText(epochMs) {
  return new Date(epochMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function daysText(n) {
  return `${n} ${n === 1 ? "day" : "days"}`;
}

// The chat's own price of a point (jettons per point), off-chain like the
// claim rules: the bot sizes every claim voucher with it. Members see each
// change on their dashboard, so the card says so before saving. A lower
// price waits the notice period (the server decides; this card explains it)
// so members can claim at the current one first.
export function PointPrice({ chatId, initDataRaw }) {
  const haptic = useHaptic();
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  const apply = useCallback((res) => {
    setData(res);
    setDraft(res.price ?? "");
  }, []);

  const load = useCallback(async () => {
    if (!initDataRaw) return;
    try {
      apply(await apiFetch(`/api/point-price?chatId=${chatId}`, { initDataRaw }));
    } catch (e) {
      setNotice({ kind: "err", text: e.message });
    }
  }, [apply, chatId, initDataRaw]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) return notice ? <Notice notice={notice} /> : null;

  const symbol = data.jetton?.symbol || "jetton";
  // Same validation the server applies, so the example never shows a price
  // it would refuse.
  let price = null;
  let invalid = null;
  // "0." is a price still being typed, not an error
  if (draft.trim() && !draft.endsWith(".")) {
    try {
      price = normalizePointPrice(draft, data.decimals_known ? data.decimals : null);
    } catch (e) {
      invalid = e.message;
    }
  }
  const pending = data.pending;
  const noticeDays = data.notice_days ?? 0;
  // Re-saving the decrease already scheduled would only restart its notice.
  const alreadyScheduled = pending && !pending.to_default && price === pending.price;
  const dirty = price !== null && price !== data.price && !alreadyScheduled;
  const lowering = dirty && data.price !== null && compareDecimal(price, data.price) < 0;
  // "Use default" is a decrease too when the default is lower.
  const resetLowers = data.custom && data.price !== null && compareDecimal(data.platform_price, data.price) < 0;
  const example = price !== null ? formatUnits(pointsToJettons(EXAMPLE_POINTS, price, data.decimals), data.decimals) : null;
  const gate = data.claim_gate;
  const paused = gate && !gate.open && gate.reason === "paused";
  const pausedText = paused
    ? `Claims are paused in this chat${gate.until ? ` until ${momentText(gate.until * 1000)}` : ""}: members cannot claim at the current price while paused, so the notice does not help them. Resume claims in Claim rules below first.`
    : null;
  // Client clock: an estimate for the explanation, the server sets the date.
  const scheduledFor = momentText(Date.now() + noticeDays * DAY_MS);
  const decreaseText =
    noticeDays > 0
      ? `A lower price takes effect after ${daysText(noticeDays)}, on about ${scheduledFor}. Until then members can still claim at 1 point = ${data.price} ${symbol}; the bot announces the decrease in the chat now and again when it applies.${
          pending ? " It replaces the decrease already scheduled." : ""
        }`
      : "A lower price also lowers the value of points members already hold. It applies right away and the bot announces it in the chat.";

  function savedText(res, lowered, next) {
    const unsent = res.announced === false ? " The bot could not be told: announce it in the chat yourself." : "";
    if (lowered && res.pending) {
      return `Decrease scheduled for ${momentText(res.pending.effective_at * 1000)}. The bot announces it in the chat.${unsent}`;
    }
    if (next === null) return `Back to the platform default.${unsent}`;
    return `Point price saved.${unsent}`;
  }

  async function post(body, action, onDone) {
    setBusy(action);
    setNotice(null);
    try {
      const res = await apiFetch("/api/point-price", { method: "POST", initDataRaw, body: { chatId, ...body } });
      apply(res);
      haptic("success");
      setNotice({ kind: "ok", text: onDone(res) });
    } catch (e) {
      haptic("error");
      setNotice({ kind: "err", text: e.message });
    } finally {
      setBusy(null);
    }
  }

  function save(next, action, lowered) {
    return post({ price: next }, action, (res) => savedText(res, lowered, next));
  }

  function cancelPending() {
    return post({ cancelPending: true }, "cancel", (res) =>
      res.announced === false
        ? "Decrease cancelled. The bot could not be told: let the chat know yourself."
        : "Decrease cancelled. The bot tells the chat the price stays.",
    );
  }

  return (
    <section className="space-y-2.5">
      <SectionHeader title="Point price" hint="What one point pays out. Free to change; a raise applies to the next claim, a cut after a notice period." />
      <Card className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <p className="font-semibold">1 point =</p>
            <Chip tone={data.custom ? "accent" : "neutral"}>{data.custom ? "your price" : "platform default"}</Chip>
          </div>
          <div className="flex h-12 items-center gap-2 rounded-xl bg-bg px-3.5 ring-accent focus-within:ring-2">
            <input
              className="min-w-0 flex-1 bg-transparent text-[17px] font-semibold tabular outline-none placeholder:font-normal placeholder:text-hint"
              inputMode="decimal"
              placeholder={data.platform_price}
              aria-label={`${symbol} per point`}
              value={draft}
              disabled={Boolean(busy)}
              onChange={(e) => setDraft(e.target.value.replace(",", ".").replace(/[^\d.]/g, ""))}
            />
            <span className="text-[15px] font-medium text-hint">{symbol}</span>
          </div>
          <p className="text-[13px] leading-snug text-hint tabular">
            {invalid ? (
              <span className="text-danger">{invalid}</span>
            ) : example !== null ? (
              <>
                {EXAMPLE_POINTS} points = <span className="font-semibold text-fg">{example} {symbol}</span>
              </>
            ) : (
              "Enter how many jettons one point is worth."
            )}
          </p>
          <p className="text-[13px] leading-snug text-hint tabular">
            Platform default: 1 point = {data.platform_price} {symbol}
            {!data.decimals_known && " · jetton decimals unknown, checked again at claim time"}
          </p>
        </div>

        {pending && (
          <div className="space-y-2 rounded-xl bg-bg p-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[13px] font-semibold">Decrease scheduled</p>
              <Chip tone="gold">{momentText(pending.effective_at * 1000)}</Chip>
            </div>
            <p className="text-[13px] leading-snug text-hint tabular">
              1 point = {pending.from ?? data.price} → <span className="font-semibold text-fg">{pending.price}</span>{" "}
              {symbol}
              {pending.to_default ? " (platform default)" : ""}. Members see it on their dashboard and the bot announced
              it in the chat; until then they claim at the current price.
            </p>
            <Button
              variant="ghost"
              size="sm"
              busy={busy === "cancel"}
              disabled={Boolean(busy)}
              onClick={cancelPending}
            >
              Cancel decrease
            </Button>
          </div>
        )}

        {pending && data.decimals_known && !priceFitsDecimals(pending.price, data.decimals) && (
          <Notice
            notice={{
              kind: "err",
              text: `The jetton now has ${data.decimals} decimals: ${pending.price} ${symbol} per point is finer than its smallest unit, so claims will be refused once this decrease applies. Cancel it or schedule a coarser price.`,
            }}
          />
        )}

        {lowering && <Notice notice={{ kind: "info", text: decreaseText }} />}
        {pending && dirty && !lowering && (
          <p className="text-[13px] leading-snug text-hint">Saving this price cancels the scheduled decrease.</p>
        )}
        {alreadyScheduled && (
          <p className="text-[13px] leading-snug text-hint">This decrease is already scheduled.</p>
        )}
        {(lowering || pending) && pausedText && <Notice notice={{ kind: "err", text: pausedText }} />}

        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            busy={busy === "save"}
            disabled={Boolean(busy) || !dirty}
            onClick={() => save(price, "save", lowering)}
          >
            {lowering && noticeDays > 0 ? "Schedule decrease" : "Save price"}
          </Button>
          {data.custom && !pending?.to_default && (
            <Button
              variant="ghost"
              busy={busy === "reset"}
              disabled={Boolean(busy)}
              onClick={() => save(null, "reset", resetLowers)}
            >
              Use default
            </Button>
          )}
        </div>
        {data.custom && resetLowers && noticeDays > 0 && !pending?.to_default && (
          <p className="text-[13px] leading-snug text-hint">
            The default ({data.platform_price} {symbol}) is lower than your price, so going back to it is a decrease: it
            waits {daysText(noticeDays)} too.
          </p>
        )}

        {data.history.length > 0 && (
          <div className="space-y-1.5 border-t border-[color:var(--separator)] pt-3">
            <p className="text-[13px] font-semibold text-hint">Recent changes · visible to members</p>
            <ul className="space-y-1 text-[13px] tabular">
              {data.history.slice(0, 3).map((h, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="text-hint">{formatDate(h.at)}</span>
                  <span>
                    {h.old} → {h.new} {symbol}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Notice notice={notice} />
      </Card>
    </section>
  );
}
