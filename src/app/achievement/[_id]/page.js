"use client";

import { useEffect, useState } from "react";
import { useInitDataRaw } from "@tma.js/sdk-react";
import { useTonAddress, useTonConnectUI } from "@tonconnect/ui-react";
import { apiFetch, sleep } from "@/lib/client-api";
import { AppShell, Screen, TopBar, useHaptic, useTelegramBack } from "@/components/AppShell";
import { AchievementArt, Button, Card, ChatAvatar, Chip, Notice, Skeleton, titleCase } from "@/components/ui";
import { Check, Medal, Sparkles } from "@/components/icons";

function formatTon(nanotons) {
  const v = BigInt(nanotons || 0);
  const frac = (v % 1000000000n).toString().padStart(9, "0").replace(/0+$/, "");
  return `${v / 1000000000n}${frac ? `.${frac}` : ""}`;
}

// Mints the medal as an NFT through the AchievementRegistry: the backend
// signs a MintVoucher bound to this Telegram user, the registry allows one
// NFT per (achievement, user) and refunds whatever the mint did not use.
function MintCard({ achievement, initDataRaw, onMinted }) {
  const wallet = useTonAddress();
  const [tonConnectUI] = useTonConnectUI();
  const haptic = useHaptic();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const nft = achievement.nft;

  if (!nft?.mintable) {
    return (
      <Card className="flex gap-3">
        <div className="tint-accent flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-accent">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <p className="font-semibold">Mint as NFT — coming soon</p>
          <p className="mt-0.5 text-[14px] leading-snug text-hint">
            This medal can&apos;t be minted to a TON wallet yet.
          </p>
        </div>
      </Card>
    );
  }

  if (nft.minted) {
    return (
      <Card className="flex items-center gap-3">
        <div className="tint-success flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-success">
          <Check className="h-5 w-5" />
        </div>
        <div>
          <p className="font-semibold">Minted</p>
          <p className="mt-0.5 text-[14px] leading-snug text-hint">This medal is an NFT in your TON wallet.</p>
        </div>
      </Card>
    );
  }

  async function mint() {
    if (!wallet) {
      tonConnectUI.openModal();
      return;
    }
    setBusy(true);
    setNotice({ kind: "info", text: "Preparing the mint…" });
    try {
      const tx = await apiFetch("/api/mint-voucher", {
        method: "POST",
        initDataRaw,
        body: { achievementId: achievement._id, wallet },
      });
      setNotice({ kind: "info", text: "Confirm in your wallet." });
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 300,
        messages: [{ address: tx.to, amount: tx.amount, payload: tx.payload_b64 }],
      });
      setNotice({ kind: "info", text: "Minting on-chain…" });
      for (let i = 0; i < 24; i++) {
        await sleep(5000);
        const fresh = await apiFetch(`/api/achievement?_id=${encodeURIComponent(achievement._id)}`, { initDataRaw }).catch(
          () => null,
        );
        if (fresh?.nft?.minted) {
          haptic("success");
          setNotice(null);
          onMinted(fresh);
          return;
        }
      }
      setNotice({ kind: "info", text: "Still confirming — check your wallet in a minute." });
    } catch (e) {
      haptic("error");
      setNotice({ kind: "err", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex gap-3">
        <div className="tint-gold flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[color:var(--gold-text)]">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <p className="font-semibold">Mint as NFT</p>
          <p className="mt-0.5 text-[14px] leading-snug text-hint">
            Keep this medal in your TON wallet as a collectible. Up to {formatTon(nft.price_ton)} TON, unused TON
            comes back.
          </p>
        </div>
      </div>
      <Button className="w-full" busy={busy} onClick={mint}>
        {wallet ? "Mint NFT" : "Connect wallet"}
      </Button>
      <Notice notice={notice} />
    </Card>
  );
}

function AchievementView({ id }) {
  const initDataRaw = useInitDataRaw();
  useTelegramBack(true);
  const [achievement, setAchievement] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!initDataRaw) return;
    apiFetch(`/api/achievement?_id=${encodeURIComponent(id)}`, { initDataRaw })
      .then(setAchievement)
      .catch((e) => setError(e.message));
  }, [id, initDataRaw]);

  return (
    <Screen>
      <TopBar />
      {error && <Notice notice={{ kind: "err", text: error }} />}
      {!achievement && !error && (
        <>
          <Skeleton className="mx-auto aspect-square w-full max-w-sm rounded-[28px]" />
          <Skeleton className="mx-auto h-7 w-48" />
        </>
      )}
      {achievement && (
        <>
          <div className="relative mx-auto w-full max-w-sm pt-2">
            <div
              className="absolute inset-6 -z-0 rounded-full blur-3xl"
              style={{ background: "color-mix(in srgb, var(--gold) 35%, transparent)" }}
            />
            <AchievementArt
              type={achievement.type}
              collection={achievement.collection}
              className="relative aspect-square w-full rounded-[28px] shadow-xl"
            />
          </div>

          <div className="space-y-2 text-center">
            <Chip tone="gold" icon={<Medal className="h-3.5 w-3.5" />}>
              Achievement unlocked
            </Chip>
            <h1 className="text-[28px] font-bold leading-tight tracking-tight">{titleCase(achievement.type)}</h1>
            {achievement.date && (
              <p className="text-[14px] text-hint">
                {new Date(achievement.date).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            )}
          </div>

          <Card className="flex items-center gap-3">
            <ChatAvatar title={achievement.chat?.title} id={achievement.chat?.id} size={40} />
            <div className="min-w-0">
              <p className="text-[13px] text-hint">Earned in</p>
              <p className="truncate font-semibold">{achievement.chat?.title || `Chat ${achievement.chat?.id}`}</p>
            </div>
          </Card>

          <MintCard achievement={achievement} initDataRaw={initDataRaw} onMinted={setAchievement} />
        </>
      )}
    </Screen>
  );
}

export default function AchievementPage({ params }) {
  return (
    <AppShell>
      <AchievementView id={params._id} />
    </AppShell>
  );
}
