"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useInitDataRaw } from "@tma.js/sdk-react";
import { apiFetch } from "@/lib/client-api";
import { useI18n } from "@/lib/use-locale";
import { AppShell, Screen, TopBar, useTelegramBack } from "@/components/AppShell";
import { Button, Card, ChatAvatar, Chip, EmptyState, Notice, Row, Segmented, Skeleton } from "@/components/ui";
import { ChevronRight, Clock, Coins, Search, Users } from "@/components/icons";
import { PayoutRow, hasLeft, memberLabel } from "@/components/PoolAdmin";

const SORTS = ["earned", "owed", "claimed"];
const SORT_LABELS = { earned: ["Заработано", "Earned"], owed: ["К выплате", "Owed"], claimed: ["Выплачено", "Claimed"] };

function Totals({ data, ledger }) {
  const t = useI18n();
  const { L } = t;
  const { totals, jetton } = data;
  const symbol = jetton?.symbol || L("жетонов", "jetton");
  const decimals = jetton?.decimals ?? null;
  const payouts = totals.payouts;
  const inFlight = payouts.pending.count + payouts.unconfirmed.count;

  // The pool is a promise backed by a balance: compare what members could
  // claim with what the pool actually holds.
  let coverage = null;
  if (ledger !== null && ledger !== undefined && totals.owed_units !== null && BigInt(totals.owed_units) > 0n) {
    const owed = BigInt(totals.owed_units);
    const pct = Number((BigInt(ledger) * 100n) / owed);
    coverage = { pct, short: BigInt(ledger) < owed };
  }

  return (
    <Card>
      <p className="mono-label text-hint">{L("Причитается участникам", "Owed to members")}</p>
      <p className="brand-heading mt-2 text-[30px] leading-none tabular">
        {t.num(totals.owed_points)}{" "}
        <span className="text-[17px] font-semibold text-hint">
          {L(t.plural(totals.owed_points, ["балл", "балла", "баллов"], []), "pts")}
        </span>
      </p>
      {totals.owed_units !== null && (
        <p className="mt-1 text-[14px] text-hint tabular">
          ≈ {t.units(totals.owed_units, decimals)} {symbol}
        </p>
      )}
      {coverage && (
        <div className="mt-3">
          <Chip tone={coverage.short ? "danger" : "success"}>
            {coverage.short
              ? L(
                  `Пул покрывает ${coverage.pct}% — пополните его, пока участники не начали выводить`,
                  `Pool covers ${coverage.pct}% of it — top up before members claim`,
                )
              : L("Баланс пула покрывает всё, что причитается", "Pool balance covers everything owed")}
          </Chip>
        </div>
      )}
      <div className="mt-3 divide-y divide-[color:var(--separator)] border-t border-[color:var(--separator)]">
        <Row label={L("Участников с баллами", "Members with points")}>{t.num(totals.members)}</Row>
        <Row label={L("Заработано всего", "Earned in total")}>{t.pts(totals.points)}</Row>
        <Row label={L("Выплачено", "Paid out")}>
          {t.units(payouts.paid.units, decimals)} {symbol}
        </Row>
        {ledger !== null && ledger !== undefined && (
          <Row label={L("Баланс пула", "Pool balance")}>
            {t.units(ledger, decimals)} {symbol}
          </Row>
        )}
        {inFlight > 0 && (
          <Row label={L("В процессе", "In flight")}>
            {t.units(BigInt(payouts.pending.units) + BigInt(payouts.unconfirmed.units), decimals)} {symbol} ·{" "}
            {t.count(inFlight, ["вывод", "вывода", "выводов"], ["claim", "claims"])}
          </Row>
        )}
      </div>
      {payouts.other_jetton && (
        <p className="mt-2 text-[12px] leading-snug text-hint">
          {L(
            "Часть выплат была в прежнем жетоне этого чата — в суммы выше они не входят.",
            "Some payouts were made in a previous jetton of this chat and are not included in the sums above.",
          )}
        </p>
      )}
    </Card>
  );
}

function MemberRow({ chatId, member, sort }) {
  const t = useI18n();
  const { L } = t;
  const primary =
    sort === "claimed" ? member.claimed_points : sort === "owed" ? member.owed_points : member.points;
  const inFlight = member.payouts.pending.count + member.payouts.unconfirmed.count;
  return (
    <li>
      <Link href={`/deposit/${chatId}/members/${member.user_id}`} className="flex items-center gap-3 px-4 py-3 active:bg-bg">
        <ChatAvatar title={memberLabel(member, L)} id={member.user_id} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{memberLabel(member, L)}</p>
          <p className="truncate text-[13px] text-hint tabular">
            {hasLeft(member.status) ? L("Вышел · ", "Left · ") : ""}
            {sort === "earned" ? "" : L(`Заработано ${t.num(member.points)} · `, `Earned ${t.num(member.points)} · `)}
            {sort === "owed" ? "" : L(`К выплате ${t.num(member.owed_points)} · `, `Owed ${t.num(member.owed_points)} · `)}
            {L(`Выплачено ${t.num(member.payouts.paid.points)}`, `Paid ${t.num(member.payouts.paid.points)}`)}
            {member.maturing_points > 0
              ? L(` · дозревает ${t.num(member.maturing_points)}`, ` · ${t.num(member.maturing_points)} maturing`)
              : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {inFlight > 0 && <Clock className="h-4 w-4 text-[color:var(--gold)]" />}
          <span className="text-[15px] font-semibold tabular">{t.num(primary)}</span>
          <ChevronRight className="h-4 w-4 text-hint" />
        </div>
      </Link>
    </li>
  );
}

function MembersTab({ chatId, initDataRaw, onChat }) {
  const { L } = useI18n();
  const [sort, setSort] = useState("earned");
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [members, setMembers] = useState([]);
  const [ledger, setLedger] = useState(undefined);
  const [error, setError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Names live only in Telegram, so a name search filters what is loaded; a
  // numeric query is a user id and goes to the server.
  const idQuery = /^\d+$/.test(query.trim()) ? query.trim() : "";

  const fetchPage = useCallback(
    (offset) =>
      apiFetch(`/api/pool-members?chatId=${chatId}&sort=${sort}&offset=${offset}${idQuery ? `&q=${idQuery}` : ""}`, {
        initDataRaw,
      }),
    [chatId, sort, idQuery, initDataRaw],
  );

  useEffect(() => {
    if (!initDataRaw) return undefined;
    let stale = false;
    setMembers([]);
    setData(null);
    fetchPage(0)
      .then((res) => {
        if (stale) return;
        onChat({ title: res.title });
        setData(res);
        setMembers(res.members);
        setError(null);
      })
      .catch((e) => !stale && setError(e.message));
    return () => {
      stale = true;
    };
  }, [fetchPage, initDataRaw, onChat]);

  // Pool balance for the coverage check (on-chain, so slower: loads on its own).
  useEffect(() => {
    if (!initDataRaw) return;
    apiFetch(`/api/pool-status?chatId=${chatId}`, { initDataRaw })
      .then((s) => setLedger(s.ledger ?? null))
      .catch(() => setLedger(null));
  }, [chatId, initDataRaw]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await fetchPage(members.length);
      setData(res);
      setMembers((list) => [...list, ...res.members]);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }

  const needle = idQuery ? "" : query.trim().toLowerCase();
  const visible = needle
    ? members.filter((m) => `${m.name || ""} ${m.username || ""} ${m.user_id}`.toLowerCase().includes(needle))
    : members;

  return (
    <>
      {error && <Notice notice={{ kind: "err", text: error }} />}
      {data ? <Totals data={data} ledger={ledger} /> : !error && <Skeleton className="h-48 w-full rounded-card" />}

      <Segmented options={SORTS} value={sort} onChange={setSort} format={(s) => L(...SORT_LABELS[s])} />

      <label className="flex h-11 items-center gap-2 rounded-xl bg-surface px-3.5 ring-accent focus-within:ring-2">
        <Search className="h-4 w-4 text-hint" />
        <input
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-hint"
          placeholder={L("Имя, @username или id пользователя", "Name, @username or user id")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      {data === null && !error ? (
        <Skeleton className="h-64 w-full rounded-card" />
      ) : visible.length ? (
        <Card flush className="overflow-hidden">
          <ul className="divide-y divide-[color:var(--separator)]">
            {visible.map((m) => (
              <MemberRow key={m.user_id} chatId={chatId} member={m} sort={sort} />
            ))}
          </ul>
        </Card>
      ) : (
        data && (
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title={query ? L("Никого не нашлось", "Nobody found") : L("Баллов пока нет ни у кого", "No member has points yet")}
          >
            {query && data.has_more
              ? L(
                  "Имена ищутся среди загруженных участников — загрузите ещё или ищите по id пользователя.",
                  "Names are searched among loaded members — load more, or search by user id.",
                )
              : L(
                  "Баллы появятся, когда участники получат реакции или начисления через /reward.",
                  "Points appear when members get reactions or /reward grants.",
                )}
          </EmptyState>
        )
      )}

      {data?.has_more && (
        <Button variant="secondary" busy={loadingMore} onClick={loadMore}>
          {L("Загрузить ещё", "Load more")}
        </Button>
      )}
    </>
  );
}

function PayoutsTab({ chatId, initDataRaw }) {
  const { L } = useI18n();
  const [payouts, setPayouts] = useState(null);
  const [next, setNext] = useState(null);
  const [error, setError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(
    (before) =>
      apiFetch(`/api/pool-payouts?chatId=${chatId}${before ? `&before=${before}` : ""}`, { initDataRaw }),
    [chatId, initDataRaw],
  );

  useEffect(() => {
    if (!initDataRaw) return;
    fetchPage(null)
      .then((res) => {
        setPayouts(res.payouts);
        setNext(res.next);
      })
      .catch((e) => setError(e.message));
  }, [fetchPage, initDataRaw]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await fetchPage(next);
      setPayouts((list) => [...list, ...res.payouts]);
      setNext(res.next);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }

  if (error) return <Notice notice={{ kind: "err", text: error }} />;
  if (payouts === null) return <Skeleton className="h-64 w-full rounded-card" />;
  if (!payouts.length) {
    return (
      <EmptyState icon={<Coins className="h-6 w-6" />} title={L("Выплат пока нет", "No payouts yet")}>
        {L(
          "Здесь появится каждый вывод участника — с кошельком, на который он ушёл.",
          "Every claim a member makes shows up here, with the wallet it went to.",
        )}
      </EmptyState>
    );
  }
  return (
    <>
      <Card className="py-1.5">
        <ul className="divide-y divide-[color:var(--separator)]">
          {payouts.map((p) => (
            <PayoutRow key={p.nonce} claim={p} who={memberLabel(p, L)} href={`/deposit/${chatId}/members/${p.user_id}`} />
          ))}
        </ul>
      </Card>
      {next && (
        <Button variant="secondary" busy={loadingMore} onClick={loadMore}>
          {L("Загрузить ещё", "Load more")}
        </Button>
      )}
    </>
  );
}

function MembersScreen({ chatId }) {
  const initDataRaw = useInitDataRaw();
  useTelegramBack(true);
  const { L } = useI18n();
  const [tab, setTab] = useState("members");
  const [chat, setChat] = useState(null);

  return (
    <Screen>
      <TopBar />
      <div className="flex items-center gap-3">
        <ChatAvatar title={chat?.title} id={chatId} size={48} />
        <div className="min-w-0">
          <h1 className="brand-heading truncate text-[22px] leading-tight">{L("Счета участников", "Member accounts")}</h1>
          <p className="truncate text-[13px] text-hint">{chat?.title || L(`Чат ${chatId}`, `Chat ${chatId}`)}</p>
        </div>
      </div>

      <Segmented
        options={["members", "payouts"]}
        value={tab}
        onChange={setTab}
        format={(t) => (t === "members" ? L("Балансы", "Balances") : L("Выплаты", "Payouts"))}
      />

      {tab === "members" ? (
        <MembersTab chatId={chatId} initDataRaw={initDataRaw} onChat={setChat} />
      ) : (
        <PayoutsTab chatId={chatId} initDataRaw={initDataRaw} />
      )}
    </Screen>
  );
}

export default function MembersPage({ params }) {
  return (
    <AppShell>
      <MembersScreen chatId={Number(params.chatId)} />
    </AppShell>
  );
}
