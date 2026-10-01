"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useInitDataRaw } from "@/components/TelegramSDK";
import { apiFetch } from "@/lib/client-api";
import { useI18n } from "@/lib/use-locale";
import { AppShell, Screen, TopBar, useTelegramBack } from "@/components/AppShell";
import { AchievementArt, Card, ChatAvatar, EmptyState, Notice, Skeleton, cx } from "@/components/ui";
import { Medal } from "@/components/icons";

const MEDALS_SHOWN = 6;
const PODIUM = ["text-[color:var(--gold-text)]", "text-hint", "text-[color:var(--brand-amber)]"];

function RatingRow({ entry }) {
  const t = useI18n();
  const { L } = t;
  const name = entry.name || L("Участник", "Member");
  const extra = entry.medals.length - MEDALS_SHOWN;
  return (
    <li
      className={cx("flex items-center gap-3 px-4 py-3", entry.me && "tint-accent")}
      aria-current={entry.me ? "true" : undefined}
    >
      <span
        className={cx(
          "w-7 shrink-0 text-center text-[15px] font-semibold tabular",
          PODIUM[entry.rank - 1] || "text-hint",
        )}
      >
        {entry.rank}
      </span>
      <ChatAvatar title={name} size={36} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">
          {name}
          {entry.me && <span className="font-normal text-hint">{L(" · вы", " · you")}</span>}
        </p>
        {entry.medals.length > 0 && (
          <div className="mt-1 flex items-center gap-1">
            {entry.medals.slice(0, MEDALS_SHOWN).map((m) => (
              <AchievementArt key={`${m.collection}/${m.type}`} type={m.type} collection={m.collection} className="h-6 w-6" />
            ))}
            {extra > 0 && <span className="text-[12px] text-hint tabular">+{t.num(extra)}</span>}
          </div>
        )}
      </div>
      <span className="flex shrink-0 items-center gap-1 text-[15px] font-semibold tabular">
        {t.num(entry.achievements)}
        <Medal className="h-4 w-4 text-hint" />
      </span>
    </li>
  );
}

function Summary({ data }) {
  const t = useI18n();
  const { L } = t;
  const mine = data.top.find((e) => e.me) || data.me;
  return (
    <Card className="flex items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--control-border)] text-[color:var(--brand-amber)]">
        <Medal className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="card-title">
          {mine
            ? L(`Вы на ${t.num(mine.rank)}-м месте`, `You're #${t.num(mine.rank)}`)
            : L("Вас пока нет в рейтинге", "You're not rated yet")}
        </p>
        <p className="mt-0.5 text-[13px] leading-snug text-hint">
          {mine
            ? L(
                `из ${t.count(data.total, ["участника", "участников", "участников"], [])} с ачивками · ${t.count(mine.achievements, ["ачивка", "ачивки", "ачивок"], [])}`,
                `of ${t.count(data.total, [], ["member", "members"])} with achievements · ${t.count(mine.achievements, [], ["achievement", "achievements"])}`,
              )
            : L(
                "Получите первую ачивку в этом чате — и вы появитесь здесь.",
                "Unlock your first achievement in this chat to appear here.",
              )}
        </p>
      </div>
    </Card>
  );
}

function RatingScreen({ chatId }) {
  const initDataRaw = useInitDataRaw();
  const router = useRouter();
  useTelegramBack(true);
  const t = useI18n();
  const { L } = t;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!initDataRaw) return;
    apiFetch(`/api/chats/${encodeURIComponent(chatId)}/rating`, { initDataRaw })
      .then((res) => {
        // a supergroup's own id: the rating is its economy's (lib/chat-ids.js)
        if (res.chat && res.chat.id !== chatId) {
          router.replace(`/rating/${res.chat.id}`);
          return;
        }
        setData(res);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [chatId, initDataRaw, router]);

  const title = data?.chat?.title || L(`Чат ${chatId}`, `Chat ${chatId}`);

  return (
    <Screen>
      <TopBar />
      <div className="flex items-center gap-3">
        <ChatAvatar title={data?.chat?.title} id={chatId} size={48} />
        <div className="min-w-0">
          <h1 className="brand-heading truncate text-[24px] leading-tight">{L("Рейтинг", "Rating")}</h1>
          <p className="truncate text-[13px] text-hint">{data || error ? title : "…"}</p>
        </div>
      </div>

      {error && <Notice notice={{ kind: "err", text: error }} />}

      {!data && !error && (
        <>
          <Skeleton className="h-[72px] w-full rounded-card" />
          <Skeleton className="h-80 w-full rounded-card" />
        </>
      )}

      {data && <Summary data={data} />}

      {data &&
        (data.top.length ? (
          <>
            <Card flush className="overflow-hidden">
              <ul className="divide-y divide-[color:var(--separator)]">
                {data.top.map((entry) => (
                  <RatingRow key={entry.rank} entry={entry} />
                ))}
              </ul>
            </Card>
            {data.me && (
              <Card flush className="overflow-hidden">
                <ul>
                  <RatingRow entry={data.me} />
                </ul>
              </Card>
            )}
            <p className="px-1 text-[12px] leading-snug text-hint">
              {L(
                `Место — по числу ачивок в этом чате; при равенстве выше тот, у кого больше баллов, затем тот, кто набрал их раньше. Показаны первые ${t.num(data.limit)}.`,
                `Ranked by achievements in this chat; ties go to more points, then to whoever got there first. Top ${t.num(data.limit)} shown.`,
              )}
            </p>
          </>
        ) : (
          <EmptyState icon={<Medal className="h-6 w-6" />} title={L("Ачивок пока нет", "No achievements yet")}>
            {L(
              "Здесь появятся участники чата, как только бот выдаст первые медали.",
              "Members show up here once the bot hands out the first medals.",
            )}
          </EmptyState>
        ))}
    </Screen>
  );
}

export default function RatingPage({ params }) {
  const { chatId } = use(params);
  return (
    <AppShell>
      <RatingScreen chatId={Number(chatId)} />
    </AppShell>
  );
}
