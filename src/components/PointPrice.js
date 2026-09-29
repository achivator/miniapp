"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client-api";
import { formatDate } from "@/lib/format";
import { compareDecimal, normalizePointPrice } from "@/lib/point-price";
import { formatUnits, pointsToJettons } from "@/lib/ton/amounts";
import { Button, Card, Chip, Notice, SectionHeader } from "./ui";
import { useHaptic } from "./AppShell";

const EXAMPLE_POINTS = 100;

// The chat's own price of a point (jettons per point), off-chain like the
// claim rules: the bot sizes every claim voucher with it. Members see each
// change on their dashboard, so the card says so before saving.
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
  if (draft.trim()) {
    try {
      price = normalizePointPrice(draft, data.decimals_known ? data.decimals : null);
    } catch (e) {
      invalid = e.message;
    }
  }
  const dirty = price !== null && price !== data.price;
  const lowering = dirty && data.price !== null && compareDecimal(price, data.price) < 0;
  const example = price !== null ? formatUnits(pointsToJettons(EXAMPLE_POINTS, price, data.decimals), data.decimals) : null;

  async function save(next, action) {
    setBusy(action);
    setNotice(null);
    try {
      apply(await apiFetch("/api/point-price", { method: "POST", initDataRaw, body: { chatId, price: next } }));
      haptic("success");
      setNotice({ kind: "ok", text: next === null ? "Back to the platform default." : "Point price saved." });
    } catch (e) {
      haptic("error");
      setNotice({ kind: "err", text: e.message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-2.5">
      <SectionHeader title="Point price" hint="What one point pays out. Free to change, applies to the next claim." />
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

        {lowering && (
          <Notice
            notice={{
              kind: "info",
              text: "A lower price also lowers the value of points members already hold. Each member sees the change on their dashboard for a week.",
            }}
          />
        )}

        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            busy={busy === "save"}
            disabled={Boolean(busy) || !dirty}
            onClick={() => save(price, "save")}
          >
            Save price
          </Button>
          {data.custom && (
            <Button variant="ghost" busy={busy === "reset"} disabled={Boolean(busy)} onClick={() => save(null, "reset")}>
              Use default
            </Button>
          )}
        </div>

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
