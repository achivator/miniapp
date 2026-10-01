"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useInitDataRaw } from "@/components/TelegramSDK";
import { useTonAddress, useTonConnectUI } from "@tonconnect/ui-react";
import { apiFetch, pollClaimStatus, sendTonTransaction, shortenAddress } from "@/lib/client-api";
import { Screen, TopBar, useHaptic, useTelegramBack } from "@/components/AppShell";
import {
  AchievementArt,
  Button,
  Card,
  ChatAvatar,
  Chip,
  EmptyState,
  Notice,
  bilingual,
  SectionHeader,
  Skeleton,
} from "@/components/ui";
import { achievementName } from "@/lib/achievements";
import { intlLocale } from "@/lib/i18n";
import { useI18n } from "@/lib/use-locale";
import { Alert, ChevronRight, Clock, Coins, Medal, Pool, Question, Sparkles } from "@/components/icons";

function shortDate(epochSec, locale) {
  return new Date(epochSec * 1000).toLocaleDateString(intlLocale(locale), { month: "short", day: "numeric" });
}

// "в понедельник", "во вторник"… by getUTCDay().
const RU_ON_WEEKDAY = ["в воскресенье", "в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу"];

// Why the chat's claims are closed right now (admin's claim rules).
function gateText(gate, { L, locale }) {
  if (!gate || gate.open) return null;
  if (gate.reason === "paused") {
    return gate.until
      ? L(`Вывод приостановлен до ${shortDate(gate.until, locale)}`, `Claims paused until ${shortDate(gate.until, locale)}`)
      : L("Вывод приостановлен админом", "Claims paused by the admin");
  }
  const day = new Date(gate.until * 1000);
  return L(
    `Вывод откроется ${RU_ON_WEEKDAY[day.getUTCDay()]}`,
    `Claims open ${day.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}`,
  );
}

// No "1 pt = X" here: each chat sets its own price and pays in its own
// jetton, so the rate lives on each reward card.
function Hero({ dashboard, achievementsCount }) {
  const t = useI18n();
  const { L } = t;
  const chats = dashboard?.rewards?.length;
  const totalPoints = dashboard?.rewards?.reduce((sum, r) => sum + (r.available_points || 0), 0) ?? null;
  return (
    // The landing's dark finale block, with the character looking in.
    <section className="ink-card relative overflow-hidden rounded-[22px] p-5">
      <Image
        src="/brand/achivator-hero-generated.png"
        alt=""
        width={1280}
        height={1280}
        priority
        sizes="150px"
        className="pointer-events-none absolute -bottom-7 -right-5 h-auto w-[150px] -scale-x-100 drop-shadow-[0_12px_10px_rgba(0,0,0,0.35)]"
      />
      <div className="relative max-w-[62%]">
        <p className="mono-label opacity-70">{L("Можно забрать", "Available to claim")}</p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
          {totalPoints === null ? (
            <div className="h-9 w-28 animate-pulse rounded-lg bg-white/15" />
          ) : (
            <span className="brand-heading text-[38px] leading-none tabular">{t.num(totalPoints)}</span>
          )}
          <span className="text-[15px] font-semibold opacity-75">
            {t.plural(totalPoints ?? 0, ["балл", "балла", "баллов"], ["point", "points"])}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="mono-label rounded-md border border-[color:var(--ink-border)] px-2 py-1">
            {chats === undefined ? `– ${L("чатов", "chats")}` : t.count(chats, ["чат", "чата", "чатов"], ["chat", "chats"])}
          </span>
          <span className="mono-label rounded-md border border-[color:var(--ink-border)] px-2 py-1">
            {achievementsCount === null
              ? `– ${L("ачивок", "achievements")}`
              : t.count(achievementsCount, ["ачивка", "ачивки", "ачивок"], ["achievement", "achievements"])}
          </span>
        </div>
      </div>
    </section>
  );
}

function RewardCard({ reward, network, initDataRaw, onRefresh }) {
  const wallet = useTonAddress();
  const [tonConnectUI] = useTonConnectUI();
  const haptic = useHaptic();
  const t = useI18n();
  const { L } = t;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const symbol = reward.symbol || L("жетона", "jetton");
  const closed = gateText(reward.claim_gate, t);
  const canClaim = reward.available_points > 0 && Boolean(reward.jetton_master) && !closed;
  const pending = reward.pending?.[0];
  const priceChange = reward.point_price_change;
  const priceDrop = reward.point_price_pending;
  // Points earned before a price decrease keep their old price: the parts of
  // the estimate priced otherwise than at the current rate.
  const breakdown = Array.isArray(reward.jettons_breakdown) ? reward.jettons_breakdown : [];
  const keptPrices =
    breakdown.length > 1 ? breakdown.filter((part) => part && Number(part.price) !== Number(reward.point_price)) : [];

  async function claim() {
    if (!wallet) {
      tonConnectUI.openModal();
      return;
    }
    setBusy(true);
    setNotice({ kind: "info", text: bilingual("Готовим вывод…", "Preparing your claim…") });
    try {
      const voucher = await apiFetch("/api/claim-voucher", {
        method: "POST",
        initDataRaw,
        body: { chatId: reward.chat_id, wallet },
      });
      // The amount is priced when the voucher is signed and may differ from
      // the estimate above if the chat's rate just changed: state it here.
      // Notice texts are drawn in the language shown at the time (see Notice).
      const jettons = (t) => `${t.decimal(voucher.jettons)} ${reward.symbol || t.L("жетона", "jetton")}`;
      setNotice({
        kind: "info",
        text: (t) => t.L(`Подтвердите в кошельке — вы получите ${jettons(t)}.`, `Confirm in your wallet to receive ${jettons(t)}.`),
      });
      await sendTonTransaction(tonConnectUI, network, [
        { address: voucher.to, amount: voucher.amount, payload: voucher.payload_b64 },
      ]);
      setNotice({ kind: "info", text: bilingual("Отправлено — ждём выплату из пула…", "Sent — waiting for the pool to pay out…") });
      const status = await pollClaimStatus(reward.chat_id, voucher.nonce, initDataRaw);
      if (status?.status === "claimed") {
        haptic("success");
        const rest = (t) =>
          voucher.remaining_points
            ? t.L(
                ` Ещё ${t.pts(voucher.remaining_points)} останутся на потом: у пула чата дневной лимит выплат.`,
                ` ${t.pts(voucher.remaining_points)} stay for later: the chat pool has a daily payout limit.`,
              )
            : "";
        setNotice({
          kind: "ok",
          text: (t) =>
            t.L(`${jettons(t)} уже в пути к вашему кошельку.${rest(t)}`, `${jettons(t)} are on their way to your wallet.${rest(t)}`),
        });
      } else {
        setNotice({
          kind: "info",
          text: bilingual("Транзакция ещё подтверждается в сети. Загляните через минуту.", "Still confirming on-chain. Check back in a minute."),
        });
      }
      onRefresh();
    } catch (e) {
      haptic("error");
      setNotice({ kind: "err", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-3">
        <ChatAvatar title={reward.title} id={reward.chat_id} />
        <div className="min-w-0 flex-1">
          <p className="card-title truncate">{reward.title || L(`Чат ${reward.chat_id}`, `Chat ${reward.chat_id}`)}</p>
          <p className="text-[13px] text-hint tabular">
            <span className="font-semibold text-fg">{t.num(reward.available_points)}</span>{" "}
            {L(t.plural(reward.available_points, ["балл", "балла", "баллов"], []), "pts")}
            {reward.jettons !== null && reward.jetton_master ? ` ≈ ${t.decimal(reward.jettons)} ${symbol}` : ""}
          </p>
        </div>
        <Button size="sm" busy={busy} disabled={!canClaim} onClick={claim}>
          {L("Забрать", "Claim")}
        </Button>
      </div>

      {(!reward.jetton_master || pending || closed || reward.maturing_points > 0 || reward.point_price) && (
        <div className="flex flex-wrap gap-2">
          {!reward.jetton_master && (
            <Chip tone="neutral">{L("В этом чате награды ещё не включены", "Rewards not enabled in this chat yet")}</Chip>
          )}
          {reward.jetton_master && reward.point_price && (
            <Chip tone="neutral">
              {L("1 балл", "1 pt")} = {t.decimal(reward.point_price)} {symbol}
            </Chip>
          )}
          {reward.jetton_master && closed && <Chip tone="neutral">{closed}</Chip>}
          {reward.maturing_points > 0 && (
            <Chip icon={<Clock className="h-3.5 w-3.5" />}>
              {L(
                `+${t.pts(reward.maturing_points)} ${t.plural(reward.maturing_points, ["дозревает", "дозревают", "дозревают"], [])}`,
                `+${t.pts(reward.maturing_points)} maturing`,
              )}
              {reward.jetton_master && reward.maturing_jettons ? ` ≈ ${t.decimal(reward.maturing_jettons)} ${symbol}` : ""}
              {reward.next_mature_at
                ? L(
                    ` · первые ${shortDate(reward.next_mature_at, t.locale)}`,
                    ` · first on ${shortDate(reward.next_mature_at, t.locale)}`,
                  )
                : ""}
            </Chip>
          )}
          {pending && (
            <Chip tone="gold" icon={<Clock className="h-3.5 w-3.5" />}>
              {pending.amount ? t.decimal(pending.amount) : "…"} {symbol}{" "}
              {L(`в обработке до ${t.time(pending.expiry)}`, `pending until ${t.time(pending.expiry)}`)}
            </Chip>
          )}
        </div>
      )}

      {reward.jetton_master &&
        keptPrices.map((part) => (
          <p key={part.price} className="text-[12px] leading-snug text-hint">
            {L(
              `${t.count(part.points, ["балл", "балла", "баллов"], [])} ${t.plural(part.points, ["сохраняет", "сохраняют", "сохраняют"], [])} цену до снижения: 1 балл = ${t.decimal(part.price)} ${symbol}`,
              `${t.pts(part.points)} keep 1 pt = ${t.decimal(part.price)} ${symbol} from before the price drop`,
            )}
          </p>
        ))}

      {/* A scheduled decrease: the notice period exists so members can claim
          at the current rate first, so this is the loudest line on the card. */}
      {reward.jetton_master && priceDrop && (
        <div
          className="tint-gold flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] font-medium leading-snug text-[color:var(--gold-text)]"
          role="alert"
        >
          <Alert className="mt-px h-4 w-4 shrink-0" />
          <span>
            {L(
              `${t.moment(priceDrop.effective_at)} цена снизится до 1 балл = ${t.decimal(priceDrop.to)} ${symbol}. Заберите баллы до этого времени — по текущему курсу.`,
              `Price drops to 1 pt = ${t.decimal(priceDrop.to)} ${symbol} on ${t.moment(priceDrop.effective_at)}. Claim before then to get the current rate.`,
            )}
          </span>
        </div>
      )}

      {/* The creator can re-price points already earned: say so for a week. */}
      {/* A jetton switch is no rate change: the old price was in another
          jetton, so "old → new" would compare different coins. */}
      {reward.jetton_master && priceChange && (
        <Notice
          notice={{
            kind: "info",
            text:
              priceChange.reason === "jetton_changed"
                ? L(
                    `Жетон наград сменился ${shortDate(priceChange.at, t.locale)}: незабранные баллы теперь выплачиваются в ${symbol}, 1 балл = ${t.decimal(priceChange.new)} ${symbol}.`,
                    `Reward jetton changed on ${shortDate(priceChange.at, t.locale)}: unclaimed points are now paid in ${symbol}, 1 pt = ${t.decimal(priceChange.new)} ${symbol}.`,
                  )
                : L(
                    `${priceChange.reason === "platform_default" ? "Курс платформы по умолчанию изменён" : "Курс изменён"} ${shortDate(priceChange.at, t.locale)}: 1 балл = ${t.decimal(priceChange.old)} → ${t.decimal(priceChange.new)} ${symbol}${
                      priceChange.changes > 1
                        ? ` (${t.count(priceChange.changes, ["изменение", "изменения", "изменений"], [])} за 7 дней)`
                        : ""
                    }`,
                    `${priceChange.reason === "platform_default" ? "Platform default rate changed" : "Rate changed"} on ${shortDate(priceChange.at, t.locale)}: 1 pt = ${t.decimal(priceChange.old)} → ${t.decimal(priceChange.new)} ${symbol}${
                      priceChange.changes > 1 ? ` (${priceChange.changes} changes in 7 days)` : ""
                    }`,
                  ),
          }}
        />
      )}

      {reward.grants?.length > 0 && (
        <ul className="divide-y divide-[color:var(--separator)] border-t border-[color:var(--separator)]">
          {reward.grants.map((grant, index) => (
            <li key={index} className="flex items-center justify-between gap-3 py-2 text-[13px] last:pb-0">
              <span className="min-w-0 truncate text-hint">
                <Sparkles className="mr-1.5 inline h-3.5 w-3.5 -translate-y-px text-[color:var(--gold)]" />
                {grant.reason || L("Начислено админом", "Granted by an admin")}
              </span>
              <span className="shrink-0 font-semibold text-success tabular">+{t.num(grant.points)}</span>
            </li>
          ))}
        </ul>
      )}

      <Notice notice={notice} />

      <RatingLink chatId={reward.chat_id} />
    </Card>
  );
}

// The foot of a chat's card: its achievement rating (app/(app)/rating/[chatId]).
function RatingLink({ chatId }) {
  const { L } = useI18n();
  return (
    <Link
      href={`/rating/${chatId}`}
      className="flex items-center justify-between gap-2 border-t border-[color:var(--separator)] pt-3 text-[13px] font-medium text-link active:opacity-80"
    >
      <span className="flex items-center gap-1.5">
        <Medal className="h-4 w-4" />
        {L("Рейтинг чата", "Chat rating")}
      </span>
      <ChevronRight className="h-4 w-4" />
    </Link>
  );
}

function RewardsSkeleton() {
  return (
    <Card className="flex items-center gap-3">
      <Skeleton className="h-11 w-11 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-9 w-20 rounded-xl" />
    </Card>
  );
}

function CreatorChats({ chats }) {
  const { L } = useI18n();
  return (
    <Card flush className="overflow-hidden">
      <ul className="divide-y divide-[color:var(--separator)]">
        {chats.map((chat) => (
          <li key={chat.chat_id}>
            <Link href={`/deposit/${chat.chat_id}`} className="flex items-center gap-3 px-4 py-3 active:bg-bg">
              <ChatAvatar title={chat.title} id={chat.chat_id} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{chat.title || L(`Чат ${chat.chat_id}`, `Chat ${chat.chat_id}`)}</p>
                <p className="truncate text-[13px] text-hint">
                  {chat.jetton_master
                    ? L(`Жетон ${shortenAddress(chat.jetton_master, 5)}`, `Jetton ${shortenAddress(chat.jetton_master, 5)}`)
                    : L("Задайте жетон командой /jetton в чате", "Set a jetton with /jetton in the chat")}
                </p>
              </div>
              <span className="flex items-center gap-1 text-[13px] font-medium text-link">
                {L("Пул", "Pool")} <ChevronRight className="h-4 w-4" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Achievements({ groups }) {
  const { L, locale } = useI18n();
  if (groups === null) {
    return (
      <Card className="grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="aspect-square rounded-2xl" />
        ))}
      </Card>
    );
  }
  if (!groups.length) {
    return (
      <EmptyState icon={<Medal className="h-6 w-6" />} title={L("Ачивок пока нет", "No achievements yet")}>
        {L(
          "Общайтесь, ставьте реакции и делитесь кодом в группах с ботом — медали открываются сами.",
          "Chat, react and share code in groups with the bot — medals unlock automatically.",
        )}
      </EmptyState>
    );
  }
  return groups.map(({ chat, achievements }) => (
    <Card key={chat.id} className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="card-title truncate">{chat.title || L(`Чат ${chat.id}`, `Chat ${chat.id}`)}</p>
        <span className="mono-label shrink-0 text-hint">ACH × {String(achievements.length).padStart(2, "0")}</span>
      </div>
      <ul className="grid grid-cols-4 gap-x-3 gap-y-4">
        {achievements.map((a) => (
          <li key={a._id}>
            <Link href={`/achievement/${a._id}`} className="group flex flex-col items-center gap-1.5">
              <AchievementArt
                type={a.type}
                collection={a.collection}
                className="aspect-square w-full transition group-active:scale-95"
              />
              <span className="line-clamp-2 text-center text-[11px] font-medium leading-tight text-hint">
                {achievementName(a.type, locale)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <RatingLink chatId={chat.id} />
    </Card>
  ));
}

export function Dashboard() {
  const initDataRaw = useInitDataRaw();
  useTelegramBack(false);
  const t = useI18n();
  const { L } = t;

  const [dashboard, setDashboard] = useState(null);
  const [achievements, setAchievements] = useState(null);
  const [error, setError] = useState(null);

  const loadDashboard = useCallback(async () => {
    if (!initDataRaw) return;
    try {
      setDashboard(await apiFetch("/api/me/chats", { initDataRaw }));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [initDataRaw]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!initDataRaw) return;
    apiFetch("/api/achievements", { initDataRaw })
      .then(setAchievements)
      .catch(() => setAchievements([]));
  }, [initDataRaw]);

  const achievementsCount = achievements?.reduce((n, g) => n + g.achievements.length, 0) ?? null;

  return (
    <Screen>
      <TopBar />

      {dashboard?.config?.network === "testnet" && (
        <div className="-mt-2 flex justify-center">
          <Chip tone="gold">{L("Тестнет — подключите тестнет-кошелёк", "Testnet — connect a testnet wallet")}</Chip>
        </div>
      )}

      <Hero dashboard={dashboard} achievementsCount={achievementsCount} />

      {error && <Notice notice={{ kind: "err", text: error }} />}

      <section className="space-y-2.5">
        <SectionHeader title={L("Награды", "Rewards")} />
        {dashboard === null ? (
          <>
            <RewardsSkeleton />
            <RewardsSkeleton />
          </>
        ) : dashboard.rewards?.length ? (
          dashboard.rewards.map((reward) => (
            <RewardCard
              key={reward.chat_id}
              reward={reward}
              network={dashboard.config?.network}
              initDataRaw={initDataRaw}
              onRefresh={loadDashboard}
            />
          ))
        ) : (
          <EmptyState icon={<Coins className="h-6 w-6" />} title={L("Наград пока нет", "No rewards yet")}>
            {L(
              "Получайте реакции на свои сообщения в чате с ботом или баллы от его админов.",
              "Get reactions on your messages in a chat with the bot, or earn points from its admins.",
            )}
          </EmptyState>
        )}
      </section>

      {dashboard?.creator?.length > 0 && (
        <section className="space-y-2.5">
          <SectionHeader title={L("Мои чаты", "My chats")} action={<Pool className="h-4 w-4 text-hint" />} />
          <CreatorChats chats={dashboard.creator} />
        </section>
      )}

      <section className="space-y-2.5">
        <SectionHeader title={L("Ачивки", "Achievements")} />
        <Achievements groups={achievements} />
      </section>

      <Link href={`/${t.locale}/help`} className="block">
        {/* the landing's locked "+18 more" card */}
        <Card className="flex items-center gap-3 border-dashed active:opacity-80">
          <Image src="/brand/locked.png" alt="" width={1280} height={1280} sizes="52px" className="h-[52px] w-[52px] shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="card-title">{L("Награды в вашем чате", "Reward your own chat")}</p>
            <p className="text-[13px] text-hint">
              {L("Как подключить свой чат — пошаговая инструкция", "Step-by-step setup guide")}
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-hint" />
        </Card>
      </Link>
    </Screen>
  );
}
