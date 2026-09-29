"use client";

import { useCallback, useEffect, useState } from "react";
import { useInitDataRaw } from "@tma.js/sdk-react";
import { apiFetch } from "@/lib/client-api";
import { formatDate, formatPoints, formatUnits } from "@/lib/format";
import { AppShell, Screen, TopBar, useTelegramBack } from "@/components/AppShell";
import { AchievementArt, Card, ChatAvatar, Chip, Notice, Row, SectionHeader, Skeleton, titleCase } from "@/components/ui";
import { Refresh, Sparkles } from "@/components/icons";
import { PayoutRow, STATE_HINT, hasLeft, memberLabel } from "@/components/PoolAdmin";

// One reactor supplying at least this share of a member's reaction points
// (with enough points to matter) is worth a look before the points mature.
const CONCENTRATION_SHARE = 0.5;
const CONCENTRATION_MIN_POINTS = 20;

function Balance({ data }) {
  const { balance, jetton, payouts } = data;
  const symbol = jetton?.symbol || "jetton";
  const decimals = jetton?.decimals ?? null;
  return (
    <Card>
      <p className="text-[13px] text-hint">Owed to this member</p>
      <p className="mt-1 text-[30px] font-bold leading-none tracking-tight tabular">
        {formatPoints(balance.owed_points)} <span className="text-[17px] font-semibold text-hint">pts</span>
      </p>
      {balance.owed_units !== null && (
        <p className="mt-1 text-[14px] text-hint tabular">
          ≈ {formatUnits(balance.owed_units, decimals)} {symbol}
        </p>
      )}
      <div className="mt-3 divide-y divide-[color:var(--separator)] border-t border-[color:var(--separator)]">
        <Row label="Earned">{formatPoints(balance.points)} pts</Row>
        <Row label="Claimable now">{formatPoints(balance.available_points)} pts</Row>
        {balance.maturing_points > 0 && (
          <Row label={`Maturing (${balance.maturation_days}d)`}>
            {formatPoints(balance.maturing_points)} pts
            {balance.next_mature_at ? ` · from ${formatDate(balance.next_mature_at)}` : ""}
          </Row>
        )}
        <Row label="Paid out">
          {formatUnits(payouts.paid.units, decimals)} {symbol} · {payouts.paid.count}×
        </Row>
        {payouts.pending.count > 0 && (
          <Row label="Pending claim">
            {formatUnits(payouts.pending.units, decimals)} {symbol}
          </Row>
        )}
      </div>
    </Card>
  );
}

function Sources({ sources }) {
  const top = sources.top_reactors[0];
  const concentrated =
    top &&
    sources.reaction_points >= CONCENTRATION_MIN_POINTS &&
    top.points / sources.reaction_points >= CONCENTRATION_SHARE;
  return (
    <section className="space-y-2.5">
      <SectionHeader title="Where the points come from" />
      <Card className="space-y-3">
        <div className="divide-y divide-[color:var(--separator)]">
          <Row label="Reactions">
            {formatPoints(sources.reaction_points)} pts · {formatPoints(sources.reactions)}×
          </Row>
          <Row label="Reactions, last 7 days">{formatPoints(sources.reaction_points_week)} pts</Row>
          <Row label="/reward grants">{formatPoints(sources.grant_points)} pts</Row>
        </div>
        {concentrated && (
          <Notice
            notice={{
              kind: "info",
              text: `${Math.round((top.points / sources.reaction_points) * 100)}% of the reaction points come from ${memberLabel(top)}. Could be a fan, could be farming — worth a look before they mature.`,
            }}
          />
        )}
        {sources.top_reactors.length > 0 && (
          <div>
            <p className="mb-1 text-[13px] font-semibold text-hint">Top reactors</p>
            <ul className="divide-y divide-[color:var(--separator)] border-t border-[color:var(--separator)]">
              {sources.top_reactors.map((r) => (
                <li key={r.user_id} className="flex items-center justify-between gap-3 py-2 text-[14px]">
                  <span className="min-w-0 truncate">{memberLabel(r)}</span>
                  <span className="shrink-0 text-hint tabular">
                    {formatPoints(r.points)} pts · {r.reactions}× · {formatDate(r.last_at)}
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
  const states = new Set(claims.map((c) => c.state));
  return (
    <section className="space-y-2.5">
      <SectionHeader title="Payout history" />
      {claims.length === 0 ? (
        <Card className="text-[14px] text-hint">No claims yet.</Card>
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
                {titleCase(s === "expired" ? "released" : s)}: {STATE_HINT[s]}
              </p>
            ))}
        </Card>
      )}
    </section>
  );
}

function Grants({ grants }) {
  if (!grants.length) return null;
  return (
    <section className="space-y-2.5">
      <SectionHeader title="Grants" hint="Points given with /reward." />
      <Card className="py-1.5">
        <ul className="divide-y divide-[color:var(--separator)]">
          {grants.map((g, i) => (
            <li key={i} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[14px]">
                  <Sparkles className="mr-1.5 inline h-3.5 w-3.5 -translate-y-px text-[color:var(--gold)]" />
                  {g.reason || "No reason given"}
                </p>
                <p className="text-[13px] text-hint">
                  {formatDate(g.date, { time: true })}
                  {g.granted_by ? ` · by ${memberLabel(g.granted_by)}` : ""}
                  {g.source === "bot-command" ? " (bot)" : ""}
                </p>
              </div>
              <span className="shrink-0 font-semibold text-success tabular">+{formatPoints(g.points)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

function Achievements({ achievements }) {
  if (!achievements.length) return null;
  return (
    <section className="space-y-2.5">
      <SectionHeader title="Achievements" />
      <Card>
        <ul className="grid grid-cols-4 gap-x-3 gap-y-4">
          {achievements.map((a) => (
            <li key={a._id} className="flex flex-col items-center gap-1.5">
              <AchievementArt type={a.type} collection={a.collection} className="aspect-square w-full" />
              <span className="line-clamp-2 text-center text-[11px] font-medium leading-tight text-hint">
                {titleCase(a.type)}
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
        <ChatAvatar title={memberLabel(member)} id={member.user_id} size={56} />
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-bold leading-tight">{memberLabel(member)}</h1>
          <p className="truncate text-[13px] text-hint">
            {member.username && member.name ? `@${member.username} · ` : ""}id {member.user_id} ·{" "}
            {data.title || `Chat ${data.chat_id}`}
          </p>
          {(hasLeft(member.status) || member.status === "administrator" || member.status === "creator") && (
            <div className="mt-1">
              <Chip tone={hasLeft(member.status) ? "danger" : "accent"}>
                {hasLeft(member.status) ? "Left the chat" : titleCase(member.status)}
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
        <Refresh className="h-4 w-4" /> Refresh
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
