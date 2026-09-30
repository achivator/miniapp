"use client";

import { useCallback, useEffect, useState } from "react";
import { useInvoice } from "@tma.js/sdk-react";
import { apiFetch, sleep } from "@/lib/client-api";
import { useI18n } from "@/lib/use-locale";
import { Button, Card, Chip, Notice, Row, SectionHeader } from "./ui";
import { useHaptic } from "./AppShell";

// The chat's Achivator subscription in Telegram Stars, for its creator:
// where it stands, what it costs now, and the button that opens Telegram's
// payment sheet. Points accrue during the trial, while paid, and for a few
// grace days after; claiming points already earned never depends on it.
// Renders nothing while subscriptions are switched off.
export function Subscription({ chatId, initDataRaw }) {
  const haptic = useHaptic();
  const invoice = useInvoice();
  const t = useI18n();
  const { L } = t;
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    if (!initDataRaw) return null;
    try {
      const res = await apiFetch(`/api/subscription?chatId=${chatId}`, { initDataRaw });
      setData(res);
      return res;
    } catch (e) {
      setNotice({ kind: "err", text: e.message });
      return null;
    }
  }, [chatId, initDataRaw]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data?.enabled) return notice ? <Notice notice={notice} /> : null;

  const sub = data.subscription;
  const renewsForYou = data.state === "paid" && sub?.recurring && sub.payer_is_you;
  const stars = `${t.num(data.price_stars)} ⭐`;

  async function subscribe() {
    setBusy(true);
    setNotice(null);
    try {
      const { link } = await apiFetch("/api/subscription", { method: "POST", initDataRaw, body: { chatId } });
      const status = await invoice.open(link, "url");
      if (status !== "paid") {
        if (status === "failed") setNotice({ kind: "err", text: L("Оплата не прошла.", "The payment failed.") });
        return;
      }
      haptic("success");
      setNotice({ kind: "info", text: L("Оплачено. Обновляем статус…", "Paid. Updating the status…") });
      // the bot records the payment when Telegram reports it, a moment later
      const before = data.paid_until;
      for (let i = 0; i < 6; i++) {
        await sleep(2000);
        const res = await load();
        if (res?.paid_until && res.paid_until !== before) break;
      }
      setNotice({ kind: "ok", text: L("Подписка оформлена. Спасибо!", "Subscribed. Thank you!") });
    } catch (e) {
      haptic("error");
      setNotice({ kind: "err", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const status = {
    not_started: {
      tone: "neutral",
      chip: L("не начат", "not started"),
      text: L(
        `Пробный период — ${t.count(data.trial_days, ["день", "дня", "дней"], ["day", "days"])} — начнётся, когда вы зададите жетон наград командой /jetton в чате.`,
        `The ${data.trial_days}-day trial starts when you set the reward jetton with /jetton in the chat.`,
      ),
    },
    trial: {
      tone: "accent",
      chip: L("пробный период", "free trial"),
      text: L(
        `Баллы начисляются бесплатно до ${t.moment(data.ends_at)}.`,
        `Points accrue for free until ${t.moment(data.ends_at)}.`,
      ),
    },
    paid: {
      tone: "success",
      chip: L("оплачено", "paid"),
      text: sub?.recurring
        ? sub.payer_is_you
          ? L(
              `Оплачено до ${t.moment(data.ends_at)}, продлевается каждый месяц. Отменить продление можно в настройках Telegram.`,
              `Paid until ${t.moment(data.ends_at)} and renews every month. You can cancel the renewal in Telegram's settings.`,
            )
          : L(
              `Оплачено до ${t.moment(data.ends_at)} с аккаунта прежнего создателя. Оформите свою подписку, чтобы начисление не прервалось.`,
              `Paid until ${t.moment(data.ends_at)} from the previous creator's account. Subscribe yourself so points keep coming.`,
            )
        : L(
            `Оплачено до ${t.moment(data.ends_at)}, без автопродления.`,
            `Paid until ${t.moment(data.ends_at)}, not renewing.`,
          ),
    },
    grace: {
      tone: "gold",
      chip: L("отсрочка", "grace period"),
      text: L(
        `Подписка закончилась ${t.moment(data.ends_at)}. Баллы начисляются ещё до ${t.moment(data.grace_until)}, потом остановятся.`,
        `The subscription ended on ${t.moment(data.ends_at)}. Points still accrue until ${t.moment(data.grace_until)}, then they stop.`,
      ),
    },
    expired: {
      tone: "danger",
      chip: L("приостановлено", "paused"),
      text: L(
        `Начисление баллов остановлено с ${t.moment(data.grace_until)}: реакции ничего не приносят, пока вы не оформите подписку.`,
        `Points stopped on ${t.moment(data.grace_until)}: reactions earn nothing until you subscribe.`,
      ),
    },
  }[data.state];

  return (
    <section className="space-y-2.5">
      <SectionHeader
        title={L("Подписка", "Subscription")}
        hint={L(
          "Оплачивает начисление баллов за реакции. Забрать уже заработанные баллы участники могут всегда.",
          "Pays for points from reactions. Members can always claim the points they have already earned.",
        )}
      />
      <Card className="space-y-3">
        {status && (
          <div className="space-y-2">
            <Chip tone={status.tone}>{status.chip}</Chip>
            <p className="text-[15px] leading-snug">{status.text}</p>
          </div>
        )}
        <div>
          <Row label={L("Активных за 30 дней", `Active in ${data.active_window_days} days`)}>{t.num(data.active_members)}</Row>
          <Row label={L("Цена в месяц", "Price per month")}>{stars}</Row>
        </div>
        <p className="text-[13px] leading-snug text-hint">
          {L(
            "Цена зависит от числа участников, писавших в чат за последние 30 дней, и фиксируется при оформлении: продление идёт по той же цене.",
            "The price follows the members who wrote in the chat in the last 30 days and is fixed when you subscribe: renewals keep it.",
          )}
        </p>
        {data.has_jetton && !renewsForYou && (
          <Button className="w-full" busy={busy} disabled={busy} onClick={subscribe}>
            {L(`Подписаться · ${stars} в мес.`, `Subscribe · ${stars} a month`)}
          </Button>
        )}
        <Notice notice={notice} />
      </Card>
    </section>
  );
}
