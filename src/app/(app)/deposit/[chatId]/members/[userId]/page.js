"use client";

import { useCallback, useEffect, useState } from "react";
import { useInitDataRaw } from "@tma.js/sdk-react";
import { achievementName } from "@/lib/achievements";
import { apiFetch } from "@/lib/client-api";
import { useI18n } from "@/lib/use-locale";
import { AppShell, Screen, TopBar, useTelegramBack } from "@/components/AppShell";
import { AchievementArt, Card, ChatAvatar, Chip, Notice, Row, SectionHeader, Skeleton } from "@/components/ui";
import { Refresh, Sparkles } from "@/components/icons";
import { PayoutRow, hasLeft, memberLabel, stateHint, stateLabel } from "@/components/PoolAdmin";

// One reactor supplying at least this share of a member's reaction points
// (with enough points to matter) is worth a look before the points mature.
const CONCENTRATION_SHARE = 0.5;
const CONCENTRATION_MIN_POINTS = 20;

// Telegram's chat member statuses shown on the member's chip.
const STATUS_LABELS = { administrator: ["Админ", "Administrator"], creator: ["Создатель", "Creator"] };

function Balance({ data }) {
  const t = useI18n();
  const { L } = t;
  const { balance, jetton, payouts } = data;
  const symbol = jetton?.symbol || L("жетонов", "jetton");
  const decimals = jetton?.decimals ?? null;
  // Points earned before a price decrease keep their old price.
  const owedParts = Array.isArray(balance.owed_breakdown) && balance.owed_breakdown.length > 1 ? balance.owed_breakdown : [];
  return (
    <Card>
      <p className="mono-label text-hint">{L("Причитается участнику", "Owed to this member")}</p>
      <p className="brand-heading mt-2 text-[30px] leading-none tabular">
        {t.num(balance.owed_points)}{" "}
        <span className="text-[17px] font-semibold text-hint">
          {L(t.plural(balance.owed_points, ["балл", "балла", "баллов"], []), "pts")}
        </span>
      </p>
      {balance.owed_units !== null && (
        <p className="mt-1 text-[14px] text-hint tabular">
          ≈ {t.units(balance.owed_units, decimals)} {symbol}
        </p>
      )}
      {owedParts.map((part) => (
        <p key={part.price} className="text-[12px] text-hint tabular">
          {L(
            `${t.count(part.points, ["балл", "балла", "баллов"], [])} по 1 балл = ${t.decimal(part.price)} ${symbol} → ${t.units(part.units, decimals)} ${symbol}`,
            `${t.pts(part.points)} at 1 pt = ${t.decimal(part.price)} ${symbol} → ${t.units(part.units, decimals)} ${symbol}`,
          )}
        </p>
      ))}
      <div className="mt-3 divide-y divide-[color:var(--separator)] border-t border-[color:var(--separator)]">
        <Row label={L("Заработано", "Earned")}>{t.pts(balance.points)}</Row>
        <Row label={L("Можно забрать сейчас", "Claimable now")}>{t.pts(balance.available_points)}</Row>
        {balance.maturing_points > 0 && (
          <Row label={L(`Дозревают (${balance.maturation_days} дн.)`, `Maturing (${balance.maturation_days}d)`)}>
            {t.pts(balance.maturing_points)}
            {balance.next_mature_at ? L(` · с ${t.date(balance.next_mature_at)}`, ` · from ${t.date(balance.next_mature_at)}`) : ""}
          </Row>
        )}
        <Row label={L("Выплачено", "Paid out")}>
          {t.units(payouts.paid.units, decimals)} {symbol} · {payouts.paid.count}×
        </Row>
        {payouts.pending.count > 0 && (
          <Row label={L("Вывод в ожидании", "Pending claim")}>
            {t.units(payouts.pending.units, decimals)} {symbol}
          </Row>
        )}
      </div>
    </Card>
  );
}

function Sources({ sources }) {
  const t = useI18n();
  const { L } = t;
  const top = sources.top_reactors[0];
  const concentrated =
    top &&
    sources.reaction_points >= CONCENTRATION_MIN_POINTS &&
    top.points / sources.reaction_points >= CONCENTRATION_SHARE;
  return (
    <section className="space-y-2.5">
      <SectionHeader title={L("Откуда баллы", "Where the points come from")} />
      <Card className="space-y-3">
        <div className="divide-y divide-[color:var(--separator)]">
          <Row label={L("Реакции", "Reactions")}>
            {t.pts(sources.reaction_points)} · {t.num(sources.reactions)}×
          </Row>
          <Row label={L("Реакции за 7 дней", "Reactions, last 7 days")}>{t.pts(sources.reaction_points_week)}</Row>
          <Row label={L("Начисления /reward", "/reward grants")}>{t.pts(sources.grant_points)}</Row>
        </div>
        {concentrated && (
          <Notice
            notice={{
              kind: "info",
              text: L(
                `${Math.round((top.points / sources.reaction_points) * 100)}% баллов за реакции — от ${memberLabel(top, L)}. Может, это поклонник, а может, накрутка — стоит проверить, пока баллы не дозрели.`,
                `${Math.round((top.points / sources.reaction_points) * 100)}% of the reaction points come from ${memberLabel(top, L)}. Could be a fan, could be farming — worth a look before they mature.`,
              ),
            }}
          />
        )}
        {sources.top_reactors.length > 0 && (
          <div>
            <p className="mb-1 text-[13px] font-semibold text-hint">{L("Кто чаще ставит реакции", "Top reactors")}</p>
            <ul className="divide-y divide-[color:var(--separator)] border-t border-[color:var(--separator)]">
              {sources.top_reactors.map((r) => (
                <li key={r.user_id} className="flex items-center justify-between gap-3 py-2 text-[14px]">
                  <span className="min-w-0 truncate">{memberLabel(r, L)}</span>
                  <span className="shrink-0 text-hint tabular">
                    {t.pts(r.points)} · {t.num(r.reactions)}× · {t.date(r.last_at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </section>
  );
}

function Payouts({ claims }) {
  const { L } = useI18n();
  const states = new Set(claims.map((c) => c.state));
  return (
    <section className="space-y-2.5">
      <SectionHeader title={L("История выплат", "Payout history")} />
      {claims.length === 0 ? (
        <Card className="text-[14px] text-hint">{L("Выводов пока не было.", "No claims yet.")}</Card>
      ) : (
        <Card className="py-1.5">
          <ul className="divide-y divide-[color:var(--separator)]">
            {claims.map((c) => (
              <PayoutRow key={c.nonce} claim={c} />
            ))}
          </ul>
          {["pending", "unconfirmed", "expired"]
            .filter((s) => states.has(s))
            .map((s) => (
              <p key={s} className="pb-1.5 text-[12px] leading-snug text-hint">
                {stateLabel(s, L)}: {stateHint(s, L)}
              </p>
            ))}
        </Card>
      )}
    </section>
  );
}

function Grants({ grants }) {
  const t = useI18n();
  const { L } = t;
  if (!grants.length) return null;
  return (
    <section className="space-y-2.5">
      <SectionHeader title={L("Начисления", "Grants")} hint={L("Баллы, выданные командой /reward.", "Points given with /reward.")} />
      <Card className="py-1.5">
        <ul className="divide-y divide-[color:var(--separator)]">
          {grants.map((g, i) => (
            <li key={i} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[14px]">
                  <Sparkles className="mr-1.5 inline h-3.5 w-3.5 -translate-y-px text-[color:var(--gold)]" />
                  {g.reason || L("Без причины", "No reason given")}
                </p>
                <p className="text-[13px] text-hint">
                  {t.date(g.date, { time: true })}
                  {g.granted_by ? L(` · от ${memberLabel(g.granted_by, L)}`, ` · by ${memberLabel(g.granted_by, L)}`) : ""}
                  {g.source === "bot-command" ? L(" (бот)", " (bot)") : ""}
                </p>
              </div>
              <span className="shrink-0 font-semibold text-success tabular">+{t.num(g.points)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

function Achievements({ achievements }) {
  const { L, locale } = useI18n();
  if (!achievements.length) return null;
  return (
    <section className="space-y-2.5">
      <SectionHeader title={L("Ачивки", "Achievements")} />
      <Card>
        <ul className="grid grid-cols-4 gap-x-3 gap-y-4">
          {achievements.map((a) => (
            <li key={a._id} className="flex flex-col items-center gap-1.5">
              <AchievementArt type={a.type} collection={a.collection} className="aspect-square w-full" />
              <span className="line-clamp-2 text-center text-[11px] font-medium leading-tight text-hint">
                {achievementName(a.type, locale)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

function MemberScreen({ chatId, userId }) {
  const initDataRaw = useInitDataRaw();
  useTelegramBack(true);
  const { L } = useI18n();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!initDataRaw) return;
    setLoading(true);
    try {
      setData(await apiFetch(`/api/pool-member?chatId=${chatId}&userId=${userId}`, { initDataRaw }));
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [chatId, userId, initDataRaw]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) {
    return (
      <Screen>
        <TopBar />
        {error ? (
          <Notice notice={{ kind: "err", text: error }} />
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Skeleton className="h-14 w-14 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
            <Skeleton className="h-48 w-full rounded-card" />
            <Skeleton className="h-36 w-full rounded-card" />
          </>
        )}
      </Screen>
    );
  }

  const { member } = data;
  return (
    <Screen>
      <TopBar />
      <div className="flex items-center gap-3">
        <ChatAvatar title={memberLabel(member, L)} id={member.user_id} size={56} />
        <div className="min-w-0">
          <h1 className="brand-heading truncate text-[24px] leading-tight">{memberLabel(member, L)}</h1>
          <p className="truncate text-[13px] text-hint">
            {member.username && member.name ? `@${member.username} · ` : ""}id {member.user_id} ·{" "}
            {data.title || L(`Чат ${data.chat_id}`, `Chat ${data.chat_id}`)}
          </p>
          {(hasLeft(member.status) || member.status === "administrator" || member.status === "creator") && (
            <div className="mt-1">
              <Chip tone={hasLeft(member.status) ? "danger" : "neutral"}>
                {hasLeft(member.status) ? L("Вышел из чата", "Left the chat") : L(...STATUS_LABELS[member.status])}
              </Chip>
            </div>
          )}
        </div>
      </div>

      {error && <Notice notice={{ kind: "err", text: error }} />}
      <Balance data={data} />
      <Sources sources={data.sources} />
      <Payouts claims={data.claims} />
      <Grants grants={data.grants} />
      <Achievements achievements={data.achievements} />

      <button
        className="mx-auto flex items-center gap-1.5 py-2 text-[14px] font-medium text-link disabled:opacity-50"
        onClick={load}
        disabled={loading}
      >
        <Refresh className="h-4 w-4" /> {L("Обновить", "Refresh")}
      </button>
    </Screen>
  );
}

export default function MemberPage({ params }) {
  return (
    <AppShell>
      <MemberScreen chatId={Number(params.chatId)} userId={Number(params.userId)} />
    </AppShell>
  );
}
