"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Address } from "@ton/core";
import { useInitDataRaw } from "@tma.js/sdk-react";
import { useTonAddress, useTonConnectUI } from "@tonconnect/ui-react";
import { apiFetch, sendTonTransaction, shortenAddress, sleep } from "@/lib/client-api";
import { formatExact, formatUnits } from "@/lib/format";
import { AppShell, Screen, TopBar, useHaptic, useTelegramBack } from "@/components/AppShell";
import { Button, Card, ChatAvatar, Chip, Notice, Row, SectionHeader, Skeleton } from "@/components/ui";
import { ArrowDown, ArrowUp, Check, ChevronRight, Refresh, Shield, Users } from "@/components/icons";
import { ClaimRules } from "@/components/ClaimRules";

function formatTon(nanotons) {
  return formatUnits(nanotons, 9);
}

function sameAddress(a, b) {
  try {
    return Boolean(a && b) && Address.parse(a).equals(Address.parse(b));
  } catch {
    return false;
  }
}

function AmountField({ value, onChange, symbol, onMax, disabled }) {
  return (
    <div className="flex h-12 items-center gap-2 rounded-xl bg-bg px-3.5 ring-accent focus-within:ring-2">
      <input
        className="min-w-0 flex-1 bg-transparent text-[17px] font-semibold tabular outline-none placeholder:font-normal placeholder:text-hint"
        inputMode="decimal"
        placeholder="0.00"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(",", ".").replace(/[^\d.]/g, ""))}
      />
      {onMax && (
        <button type="button" className="text-[13px] font-semibold text-link" onClick={onMax} disabled={disabled}>
          Max
        </button>
      )}
      <span className="text-[15px] font-medium text-hint">{symbol}</span>
    </div>
  );
}

function PoolManager({ chatId }) {
  const initDataRaw = useInitDataRaw();
  const wallet = useTonAddress();
  const [tonConnectUI] = useTonConnectUI();
  const haptic = useHaptic();
  useTelegramBack(true);

  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // which action is running
  const [notice, setNotice] = useState(null);
  const [amount, setAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [limitAmount, setLimitAmount] = useState("");

  const load = useCallback(async () => {
    if (!initDataRaw) return null;
    try {
      const status = await apiFetch(`/api/pool-status?chatId=${chatId}`, { initDataRaw });
      setInfo(status);
      setError(null);
      return status;
    } catch (e) {
      setError(e.message);
      return null;
    }
  }, [chatId, initDataRaw]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action, fn) {
    if (!wallet) {
      tonConnectUI.openModal();
      return;
    }
    setBusy(action);
    try {
      await fn();
    } catch (e) {
      haptic("error");
      setNotice({ kind: "err", text: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function send(tx) {
    await sendTonTransaction(tonConnectUI, info.network, [
      { address: tx.to, amount: tx.amount, payload: tx.payload_b64 },
    ]);
  }

  // Polls pool-status until `done(status)` holds, for up to ~2 minutes.
  async function waitFor(done, pending, success) {
    setNotice({ kind: "info", text: pending });
    for (let i = 0; i < 24; i++) {
      await sleep(5000);
      const status = await load();
      if (status && done(status)) {
        haptic("success");
        setNotice({ kind: "ok", text: success });
        return;
      }
    }
    setNotice({ kind: "info", text: "Still confirming on-chain — pull Refresh in a minute." });
  }

  const activate = () =>
    run("activate", async () => {
      setNotice({ kind: "info", text: "Confirm the activation in your wallet." });
      await send({ to: info.master_address, amount: info.create_pool_ton, payload_b64: info.create_pool_body });
      await waitFor((s) => s.active, "Deploying the pool…", "The pool is live. Top it up to start rewarding.");
    });

  const deposit = () =>
    run("deposit", async () => {
      setNotice({ kind: "info", text: "Preparing the transfer…" });
      const tx = await apiFetch("/api/deposit-voucher", {
        method: "POST",
        initDataRaw,
        body: { chatId, wallet, amount },
      });
      setNotice({ kind: "info", text: `Confirm in your wallet (includes ${formatTon(tx.amount)} TON for fees).` });
      await send(tx);
      const before = BigInt(info.ledger ?? 0);
      setAmount("");
      await waitFor(
        (s) => s.ledger !== null && BigInt(s.ledger) > before,
        "Sent — waiting for the pool to credit it…",
        `Pool topped up.`,
      );
    });

  const claimAdmin = () =>
    run("admin", async () => {
      setNotice({ kind: "info", text: "Preparing the admin voucher…" });
      const tx = await apiFetch("/api/admin-voucher", { method: "POST", initDataRaw, body: { chatId, wallet } });
      setNotice({ kind: "info", text: "Confirm in your wallet." });
      await send(tx);
      await waitFor(
        (s) => sameAddress(s.pool_admin, wallet),
        "Registering this wallet as pool admin…",
        "This wallet now controls withdrawals.",
      );
    });

  const adminTx = (body) => apiFetch("/api/pool-admin-tx", { method: "POST", initDataRaw, body: { chatId, ...body } });

  const setPaused = (paused) =>
    run("pause", async () => {
      const tx = await adminTx({ action: paused ? "pause" : "resume" });
      setNotice({ kind: "info", text: "Confirm in your wallet." });
      await send(tx);
      await waitFor(
        (s) => s.controls?.paused === paused,
        paused ? "Pausing claims…" : "Resuming claims…",
        paused ? "Claims are paused. Nobody can claim until you resume." : "Claims are open again.",
      );
    });

  const saveLimit = (value) =>
    run("limit", async () => {
      const tx = await adminTx({ action: "limit", amount: value });
      setNotice({ kind: "info", text: "Confirm in your wallet." });
      await send(tx);
      setLimitAmount("");
      const before = info.controls?.limit;
      await waitFor((s) => s.controls && s.controls.limit !== before, "Updating the daily limit…", "Daily limit updated.");
    });

  const withdraw = () =>
    run("withdraw", async () => {
      const tx = await adminTx({ action: "withdraw", amount: withdrawAmount, to: wallet });
      setNotice({ kind: "info", text: "Confirm the withdrawal in your wallet." });
      await send(tx);
      const before = BigInt(info.ledger ?? 0);
      setWithdrawAmount("");
      await waitFor(
        (s) => s.ledger !== null && BigInt(s.ledger) < before,
        "Withdrawing…",
        "Jettons are on their way to your wallet.",
      );
    });

  if (!info) {
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
            <Skeleton className="h-36 w-full rounded-card" />
            <Skeleton className="h-28 w-full rounded-card" />
          </>
        )}
      </Screen>
    );
  }

  const symbol = info.jetton?.symbol || "jetton";
  const decimals = info.jetton?.decimals ?? null;
  const isAdminWallet = sameAddress(info.pool_admin, wallet);

  return (
    <Screen>
      <TopBar />

      {info.network === "testnet" && (
        <div className="-mt-2 flex justify-center">
          <Chip tone="gold">Testnet — connect a testnet wallet</Chip>
        </div>
      )}

      <div className="flex items-center gap-3">
        <ChatAvatar title={info.title} id={info.chat_id} size={56} />
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-bold leading-tight">{info.title || `Chat ${info.chat_id}`}</h1>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {info.active ? (
              <Chip tone="success" icon={<Check className="h-3.5 w-3.5" />}>Pool active</Chip>
            ) : (
              <Chip tone="neutral">Not activated</Chip>
            )}
            {info.jetton_master && <Chip tone="accent">{symbol}</Chip>}
          </div>
        </div>
      </div>

      <Card>
        <p className="text-[13px] text-hint">Reward pool</p>
        <p className="mt-1 text-[30px] font-bold leading-none tracking-tight tabular">
          {info.active ? formatUnits(info.ledger, decimals) : "0"}{" "}
          <span className="text-[17px] font-semibold text-hint">{symbol}</span>
        </p>
        <div className="mt-3 divide-y divide-[color:var(--separator)] border-t border-[color:var(--separator)]">
          {info.pool_address && <Row label="Pool contract">{shortenAddress(info.pool_address, 5)}</Row>}
          <Row label={`Deposit fee · tier ${info.fee.tier}`}>{info.fee.fee_ton} TON</Row>
          {info.member_count !== null && <Row label="Members">{info.member_count.toLocaleString("en-US")}</Row>}
          {info.active && (
            <Row label="Admin wallet">{info.pool_admin ? shortenAddress(info.pool_admin, 5) : "not set"}</Row>
          )}
        </div>
      </Card>

      {info.is_creator && (
        <Link href={`/deposit/${chatId}/members`} className="block">
          <Card className="flex items-center gap-3 active:opacity-80">
            <div className="tint-accent flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-accent">
              <Users className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Member accounts</p>
              <p className="text-[13px] text-hint">Who earned what, what is owed, payout history</p>
            </div>
            <ChevronRight className="h-5 w-5 text-hint" />
          </Card>
        </Link>
      )}

      {!info.jetton_master && (
        <Notice notice={{ kind: "info", text: "Set the reward jetton first: send /jetton <master address> in the chat." }} />
      )}

      {!info.is_creator && (
        <Notice notice={{ kind: "info", text: "Only the chat creator can manage this pool." }} />
      )}

      {info.is_creator && !info.active && (
        <section className="space-y-2.5">
          <SectionHeader title="Activate" />
          <Card className="space-y-3">
            <p className="text-[15px] leading-snug text-hint">
              Deploy this chat&apos;s reward pool — a contract only you (and member claims signed by the bot) can
              move jettons out of. One-time, {formatTon(info.create_pool_ton)} TON.
            </p>
            <Button className="w-full" busy={busy === "activate"} disabled={Boolean(busy)} onClick={activate}>
              {wallet ? "Activate pool" : "Connect wallet"}
            </Button>
          </Card>
        </section>
      )}

      {info.is_creator && info.active && info.jetton_master && !info.pool_admin && (
        <section className="space-y-2.5">
          <SectionHeader title="Step 1 · Admin wallet" hint="Needed before the first top-up." />
          <Card className="space-y-3">
            <div className="flex gap-3">
              <div className="tint-accent flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-accent">
                <Shield className="h-5 w-5" />
              </div>
              <p className="text-[14px] leading-snug text-hint">
                Register the connected wallet as the pool admin. Only it can withdraw, set the daily payout limit or
                pause claims, and only it can hand the role over later.
              </p>
            </div>
            <Button className="w-full" busy={busy === "admin"} disabled={Boolean(busy)} onClick={claimAdmin}>
              {wallet ? "Make this wallet the admin" : "Connect wallet"}
            </Button>
          </Card>
        </section>
      )}

      {info.is_creator && info.active && info.jetton_master && info.pool_admin && (
        <section className="space-y-2.5">
          <SectionHeader title="Top up" hint="Members claim their points from this balance." />
          <Card className="space-y-3">
            <AmountField value={amount} onChange={setAmount} symbol={symbol} disabled={Boolean(busy)} />
            <Button
              className="w-full"
              busy={busy === "deposit"}
              disabled={Boolean(busy) || (wallet && !Number(amount))}
              onClick={deposit}
            >
              <ArrowDown className="h-4 w-4" />
              {wallet ? "Top up pool" : "Connect wallet"}
            </Button>
          </Card>
        </section>
      )}

      {info.is_creator && info.jetton_master && <ClaimRules chatId={chatId} initDataRaw={initDataRaw} />}

      {info.is_creator && info.pool_admin && !isAdminWallet && (
        <Notice
          notice={{
            kind: "info",
            text: `Withdrawals and safety controls belong to ${shortenAddress(info.pool_admin, 5)}. Connect that wallet to use them.`,
          }}
        />
      )}

      {isAdminWallet && info.controls && (
        <section className="space-y-2.5">
          <SectionHeader
            title="On-chain protection"
            hint="Enforced by the pool contract itself — holds even if the bot's key is stolen."
          />
          <Card className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{info.controls.paused ? "Claims paused" : "Claims open"}</p>
                <p className="text-[13px] text-hint">
                  {info.controls.paused ? "Nobody can claim until you resume." : "Emergency stop for all member claims."}
                </p>
              </div>
              <Button
                size="sm"
                variant={info.controls.paused ? "primary" : "danger"}
                busy={busy === "pause"}
                disabled={Boolean(busy)}
                onClick={() => setPaused(!info.controls.paused)}
              >
                {info.controls.paused ? "Resume" : "Pause"}
              </Button>
            </div>
            <div className="divide-y divide-[color:var(--separator)] border-t border-[color:var(--separator)]">
              <Row label="Daily payout limit">
                {info.controls.limit === "0" ? "10% of pool" : `${formatUnits(info.controls.limit, decimals)} ${symbol}`}
              </Row>
              <Row label="Left today">
                {formatUnits(info.controls.claimable_today, decimals)} {symbol}
              </Row>
            </div>
            <AmountField value={limitAmount} onChange={setLimitAmount} symbol={`${symbol}/day`} disabled={Boolean(busy)} />
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                busy={busy === "limit"}
                disabled={Boolean(busy) || !Number(limitAmount)}
                onClick={() => saveLimit(limitAmount)}
              >
                Set limit
              </Button>
              {info.controls.limit !== "0" && (
                <Button variant="ghost" disabled={Boolean(busy)} onClick={() => saveLimit("0")}>
                  Use 10%
                </Button>
              )}
            </div>
          </Card>
        </section>
      )}

      {isAdminWallet && info.jetton_master && (
        <section className="space-y-2.5">
          <SectionHeader title="Withdraw" hint="Take jettons back from the pool." />
          <Card className="space-y-3">
            <AmountField
              value={withdrawAmount}
              onChange={setWithdrawAmount}
              symbol={symbol}
              disabled={Boolean(busy)}
              onMax={() => setWithdrawAmount(formatExact(info.ledger, decimals))}
            />
            <Button
              variant="danger"
              className="w-full"
              busy={busy === "withdraw"}
              disabled={Boolean(busy) || !Number(withdrawAmount)}
              onClick={withdraw}
            >
              <ArrowUp className="h-4 w-4" />
              Withdraw to my wallet
            </Button>
          </Card>
        </section>
      )}

      <Notice notice={notice} />

      <button
        className="mx-auto flex items-center gap-1.5 py-2 text-[14px] font-medium text-link disabled:opacity-50"
        onClick={load}
        disabled={Boolean(busy)}
      >
        <Refresh className="h-4 w-4" /> Refresh
      </button>
    </Screen>
  );
}

export default function DepositPage({ params }) {
  return (
    <AppShell>
      <PoolManager chatId={Number(params.chatId)} />
    </AppShell>
  );
}
