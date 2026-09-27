"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useInitDataRaw } from "@tma.js/sdk-react";
import { useTonAddress, useTonConnectUI } from "@tonconnect/ui-react";
import { apiFetch, pollClaimStatus, sendTonTransaction, shortenAddress } from "@/lib/client-api";
import { AppShell, Screen, TopBar, useHaptic, useTelegramBack } from "@/components/AppShell";
import {
  AchievementArt,
  Button,
  Card,
  ChatAvatar,
  Chip,
  EmptyState,
  Notice,
  SectionHeader,
  Skeleton,
  titleCase,
} from "@/components/ui";
import { ChevronRight, Clock, Coins, Medal, Pool, Question, Sparkles } from "@/components/icons";

const numberFormat = new Intl.NumberFormat("en-US");

function shortDate(epochSec) {
  return new Date(epochSec * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Why the chat's claims are closed right now (admin's claim rules).
function gateText(gate) {
  if (!gate || gate.open) return null;
  if (gate.reason === "paused") return gate.until ? `Claims paused until ${shortDate(gate.until)}` : "Claims paused by the admin";
  return `Claims open ${new Date(gate.until * 1000).toLocaleDateString(undefined, { weekday: "long", timeZone: "UTC" })}`;
}

function Hero({ dashboard, achievementsCount }) {
  const totalPoints = dashboard?.rewards?.reduce((sum, r) => sum + (r.available_points || 0), 0) ?? null;
  const rate = dashboard?.config?.jettons_per_point;
  return (
    <section className="hero-gradient relative overflow-hidden rounded-[22px] p-5 shadow-lg">
      <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -bottom-12 right-10 h-28 w-28 rounded-full bg-white/10" />
      <p className="text-[13px] font-medium opacity-80">Available to claim</p>
      <div className="mt-1 flex items-baseline gap-2">
        {totalPoints === null ? (
          <div className="h-9 w-28 animate-pulse rounded-lg bg-white/25" />
        ) : (
          <span className="text-[36px] font-bold leading-none tracking-tight tabular">
            {numberFormat.format(totalPoints)}
          </span>
        )}
        <span className="text-[15px] font-semibold opacity-80">points</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-[12px] font-medium">
        <span className="rounded-full bg-white/20 px-2.5 py-1">
          {dashboard?.rewards?.length ?? "–"} {dashboard?.rewards?.length === 1 ? "chat" : "chats"}
        </span>
        <span className="rounded-full bg-white/20 px-2.5 py-1">
          {achievementsCount ?? "–"} {achievementsCount === 1 ? "achievement" : "achievements"}
        </span>
        {rate && <span className="rounded-full bg-white/20 px-2.5 py-1">1 pt = {rate} jetton</span>}
      </div>
    </section>
  );
}

function RewardCard({ reward, network, initDataRaw, onRefresh }) {
  const wallet = useTonAddress();
  const [tonConnectUI] = useTonConnectUI();
  const haptic = useHaptic();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const symbol = reward.symbol || "jetton";
  const closed = gateText(reward.claim_gate);
  const canClaim = reward.available_points > 0 && Boolean(reward.jetton_master) && !closed;
  const pending = reward.pending?.[0];

  async function claim() {
    if (!wallet) {
      tonConnectUI.openModal();
      return;
    }
    setBusy(true);
    setNotice({ kind: "info", text: "Preparing your claim…" });
    try {
      const voucher = await apiFetch("/api/claim-voucher", {
        method: "POST",
        initDataRaw,
        body: { chatId: reward.chat_id, wallet },
      });
      setNotice({ kind: "info", text: "Confirm the transaction in your wallet." });
      await sendTonTransaction(tonConnectUI, network, [
        { address: voucher.to, amount: voucher.amount, payload: voucher.payload_b64 },
      ]);
      setNotice({ kind: "info", text: "Sent — waiting for the pool to pay out…" });
      const status = await pollClaimStatus(reward.chat_id, voucher.nonce, initDataRaw);
      if (status?.status === "claimed") {
        haptic("success");
        const rest = voucher.remaining_points
          ? ` ${numberFormat.format(voucher.remaining_points)} pts stay for later: the chat pool has a daily payout limit.`
          : "";
        setNotice({ kind: "ok", text: `${voucher.jettons} ${symbol} are on their way to your wallet.${rest}` });
      } else {
        setNotice({ kind: "info", text: "Still confirming on-chain. Check back in a minute." });
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
          <p className="truncate font-semibold">{reward.title || `Chat ${reward.chat_id}`}</p>
          <p className="text-[13px] text-hint tabular">
            <span className="font-semibold text-fg">{numberFormat.format(reward.available_points)}</span> pts
            {reward.jettons !== null && reward.jetton_master ? ` ≈ ${reward.jettons} ${symbol}` : ""}
          </p>
        </div>
        <Button size="sm" busy={busy} disabled={!canClaim} onClick={claim}>
          Claim
        </Button>
      </div>

      {(!reward.jetton_master || pending || closed || reward.maturing_points > 0) && (
        <div className="flex flex-wrap gap-2">
          {!reward.jetton_master && <Chip tone="neutral">Rewards not enabled in this chat yet</Chip>}
          {reward.jetton_master && closed && <Chip tone="neutral">{closed}</Chip>}
          {reward.maturing_points > 0 && (
            <Chip tone="accent" icon={<Clock className="h-3.5 w-3.5" />}>
              +{numberFormat.format(reward.maturing_points)} pts maturing
              {reward.next_mature_at ? ` · first on ${shortDate(reward.next_mature_at)}` : ""}
            </Chip>
          )}
          {pending && (
            <Chip tone="gold" icon={<Clock className="h-3.5 w-3.5" />}>
              {pending.amount ?? "…"} {symbol} pending until{" "}
              {new Date(pending.expiry * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </Chip>
          )}
        </div>
      )}

      {reward.grants?.length > 0 && (
        <ul className="divide-y divide-[color:var(--separator)] border-t border-[color:var(--separator)]">
          {reward.grants.map((grant, index) => (
            <li key={index} className="flex items-center justify-between gap-3 py-2 text-[13px] last:pb-0">
              <span className="min-w-0 truncate text-hint">
                <Sparkles className="mr-1.5 inline h-3.5 w-3.5 -translate-y-px text-[color:var(--gold)]" />
                {grant.reason || "Granted by an admin"}
              </span>
              <span className="shrink-0 font-semibold text-success tabular">+{grant.points}</span>
            </li>
          ))}
        </ul>
      )}

      <Notice notice={notice} />
    </Card>
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
  return (
    <Card flush className="overflow-hidden">
      <ul className="divide-y divide-[color:var(--separator)]">
        {chats.map((chat) => (
          <li key={chat.chat_id}>
            <Link href={`/deposit/${chat.chat_id}`} className="flex items-center gap-3 px-4 py-3 active:bg-bg">
              <ChatAvatar title={chat.title} id={chat.chat_id} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{chat.title || `Chat ${chat.chat_id}`}</p>
                <p className="truncate text-[13px] text-hint">
                  {chat.jetton_master ? `Jetton ${shortenAddress(chat.jetton_master, 5)}` : "Set a jetton with /jetton in the chat"}
                </p>
              </div>
              <span className="flex items-center gap-1 text-[13px] font-medium text-link">
                Pool <ChevronRight className="h-4 w-4" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Achievements({ groups }) {
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
      <EmptyState icon={<Medal className="h-6 w-6" />} title="No achievements yet">
        Chat, react and share code in groups with the bot — medals unlock automatically.
      </EmptyState>
    );
  }
  return groups.map(({ chat, achievements }) => (
    <Card key={chat.id} className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="truncate font-semibold">{chat.title || `Chat ${chat.id}`}</p>
        <Chip tone="gold">{achievements.length}</Chip>
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
                {titleCase(a.type)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  ));
}

function Dashboard() {
  const initDataRaw = useInitDataRaw();
  useTelegramBack(false);

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
          <Chip tone="gold">Testnet — connect a testnet wallet</Chip>
        </div>
      )}

      <Hero dashboard={dashboard} achievementsCount={achievementsCount} />

      {error && <Notice notice={{ kind: "err", text: error }} />}

      <section className="space-y-2.5">
        <SectionHeader title="Rewards" />
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
          <EmptyState icon={<Coins className="h-6 w-6" />} title="No rewards yet">
            Get reactions on your messages in a chat with the bot, or earn points from its admins.
          </EmptyState>
        )}
      </section>

      {dashboard?.creator?.length > 0 && (
        <section className="space-y-2.5">
          <SectionHeader title="My chats" action={<Pool className="h-4 w-4 text-hint" />} />
          <CreatorChats chats={dashboard.creator} />
        </section>
      )}

      <section className="space-y-2.5">
        <SectionHeader title="Achievements" />
        <Achievements groups={achievements} />
      </section>

      <Link href="/help" className="block">
        <Card className="flex items-center gap-3 active:opacity-80">
          <div className="tint-accent flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-accent">
            <Question className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Reward your own chat</p>
            <p className="text-[13px] text-hint">Как подключить свой чат — пошаговая инструкция</p>
          </div>
          <ChevronRight className="h-5 w-5 text-hint" />
        </Card>
      </Link>
    </Screen>
  );
}

export default function Home() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}
