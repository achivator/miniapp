"use client";

import { useEffect, useState } from "react";
import { useInitDataRaw } from "@tma.js/sdk-react";
import { useTonAddress, useTonConnectUI } from "@tonconnect/ui-react";
import { achievementName } from "@/lib/achievements";
import { apiFetch, sendTonTransaction, sleep } from "@/lib/client-api";
import { formatDecimal, intlLocale } from "@/lib/i18n";
import { useI18n } from "@/lib/use-locale";
import { AppShell, Screen, TopBar, useHaptic, useTelegramBack } from "@/components/AppShell";
import { AchievementArt, Button, Card, ChatAvatar, Notice, Skeleton, bilingual } from "@/components/ui";
import { Check, Medal, Sparkles } from "@/components/icons";

function formatTon(nanotons, locale) {
  const v = BigInt(nanotons || 0);
  const frac = (v % 1000000000n).toString().padStart(9, "0").replace(/0+$/, "");
  return formatDecimal(`${v / 1000000000n}${frac ? `.${frac}` : ""}`, locale);
}

// Mints the medal as an NFT through the AchievementRegistry: the backend
// signs a MintVoucher bound to this Telegram user, the registry allows one
// NFT per (achievement, user) and refunds whatever the mint did not use.
function MintCard({ achievement, initDataRaw, onMinted }) {
  const wallet = useTonAddress();
  const [tonConnectUI] = useTonConnectUI();
  const haptic = useHaptic();
  const { L, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const nft = achievement.nft;

  if (!nft?.mintable) {
    return (
      <Card className="flex gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--control-border)] text-fg">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <p className="card-title">{L("Выпуск NFT — скоро", "Mint as NFT — coming soon")}</p>
          <p className="mt-0.5 text-[14px] leading-snug text-hint">
            {L("Эту медаль пока нельзя выпустить в TON-кошелёк.", "This medal can't be minted to a TON wallet yet.")}
          </p>
        </div>
      </Card>
    );
  }

  if (nft.minted) {
    return (
      <Card className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:color-mix(in_srgb,var(--success)_45%,transparent)] text-success">
          <Check className="h-5 w-5" />
        </div>
        <div>
          <p className="card-title">{L("Выпущено", "Minted")}</p>
          <p className="mt-0.5 text-[14px] leading-snug text-hint">
            {L("Эта медаль — NFT в вашем TON-кошельке.", "This medal is an NFT in your TON wallet.")}
          </p>
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
    setNotice({ kind: "info", text: bilingual("Готовим выпуск…", "Preparing the mint…") });
    try {
      const tx = await apiFetch("/api/mint-voucher", {
        method: "POST",
        initDataRaw,
        body: { achievementId: achievement._id, wallet },
      });
      setNotice({ kind: "info", text: bilingual("Подтвердите в кошельке.", "Confirm in your wallet.") });
      await sendTonTransaction(tonConnectUI, nft.network, [
        { address: tx.to, amount: tx.amount, payload: tx.payload_b64 },
      ]);
      setNotice({ kind: "info", text: bilingual("Выпускаем в сети…", "Minting on-chain…") });
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
      setNotice({
        kind: "info",
        text: bilingual("Ещё подтверждается — проверьте кошелёк через минуту.", "Still confirming — check your wallet in a minute."),
      });
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
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--control-border)] text-[color:var(--brand-amber)]">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <p className="card-title">{L("Выпустить как NFT", "Mint as NFT")}</p>
          <p className="mt-0.5 text-[14px] leading-snug text-hint">
            {L(
              `Храните медаль в TON-кошельке как коллекционный предмет. До ${formatTon(nft.price_ton, locale)} TON, неизрасходованные TON вернутся.`,
              `Keep this medal in your TON wallet as a collectible. Up to ${formatTon(nft.price_ton, locale)} TON, unused TON comes back.`,
            )}
          </p>
        </div>
      </div>
      <Button className="w-full" busy={busy} onClick={mint}>
        {wallet ? L("Выпустить NFT", "Mint NFT") : L("Подключить кошелёк", "Connect wallet")}
      </Button>
      <Notice notice={notice} />
    </Card>
  );
}

function AchievementView({ id }) {
  const initDataRaw = useInitDataRaw();
  useTelegramBack(true);
  const { L, locale } = useI18n();
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
          {/* The landing's character card: a pastel stage, an edition label
              and a rarity-style tag. */}
          <div className="brand-panel stage relative mx-auto mt-1 w-full max-w-sm overflow-hidden rounded-[22px] px-5 pb-5 pt-11">
            <span className="mono-label absolute left-4 top-4 text-[#4a4257]">
              ACH / {String(achievement.collection || "v1").toUpperCase()}
            </span>
            <AchievementArt
              type={achievement.type}
              collection={achievement.collection}
              className="aspect-square w-full rounded-[16px]"
            />
            <span className="mono-label mt-4 inline-flex items-center gap-1.5 rounded-md border border-[#c9bdd8] bg-white/70 px-2 py-1 font-semibold text-[#57407a]">
              <Medal className="h-3.5 w-3.5" />
              {L("Получена", "Unlocked")}
            </span>
          </div>

          <div className="space-y-2 text-center">
            <h1 className="brand-heading text-[30px] leading-tight">{achievementName(achievement.type, locale)}</h1>
            {achievement.date && (
              <p className="mono-label text-hint">
                {new Date(achievement.date).toLocaleDateString(intlLocale(locale), {
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
              <p className="text-[13px] text-hint">{L("Получена в чате", "Earned in")}</p>
              <p className="truncate font-semibold">
                {achievement.chat?.title || L(`Чат ${achievement.chat?.id}`, `Chat ${achievement.chat?.id}`)}
              </p>
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
