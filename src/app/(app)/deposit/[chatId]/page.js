"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Address } from "@ton/core";
import { useInitDataRaw } from "@/components/TelegramSDK";
import { useTonAddress, useTonConnectUI } from "@tonconnect/ui-react";
import { apiFetch, sendTonTransaction, shortenAddress, sleep } from "@/lib/client-api";
import { formatExact } from "@/lib/format";
import { useI18n } from "@/lib/use-locale";
import { AppShell, Screen, TopBar, useHaptic, useTelegramBack } from "@/components/AppShell";
import { Button, Card, ChatAvatar, Chip, Notice, Row, SectionHeader, Skeleton, bilingual } from "@/components/ui";
import { ArrowDown, ArrowUp, Check, ChevronRight, Refresh, Shield, Users } from "@/components/icons";
import { ClaimRules } from "@/components/ClaimRules";
import { PointPrice } from "@/components/PointPrice";
import { Subscription } from "@/components/Subscription";

function sameAddress(a, b) {
  try {
    return Boolean(a && b) && Address.parse(a).equals(Address.parse(b));
  } catch {
    return false;
  }
}

function AmountField({ value, onChange, symbol, onMax, disabled }) {
  const { L } = useI18n();
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
          {L("Всё", "Max")}
        </button>
      )}
      <span className="text-[15px] font-medium text-hint">{symbol}</span>
    </div>
  );
}

// "Set the daily limit back": the limit was raised from the price card so
// members could claim before a decrease, which is now in effect. Restoring
// is the pool admin's own "limit" transaction, like "Set limit" below.
function LimitRestoreBanner({ restore, symbol, decimals, poolAdmin, wallet, busy, onRestore, onDismiss }) {
  const t = useI18n();
  const { L } = t;
  const limitText = (units) => (units === "0" ? L("10% пула", "10% of pool") : `${t.units(units, decimals)} ${symbol}`);
  const isAdminWallet = sameAddress(poolAdmin, wallet);
  return (
    <Card className="space-y-3">
      <p className="card-title">{L(`Верните дневной лимит: ${limitText(restore.from)}`, `Restore the daily limit to ${limitText(restore.from)}`)}</p>
      <p className="text-[13px] leading-snug text-hint">
        {L(
          `Для снижения цены балла (${t.moment(restore.effective_at)}) дневной лимит выплат подняли до ${limitText(restore.to)}, чтобы все успели забрать баллы. Снижение уже действует, а лимит — защита на случай утечки ключа бота: верните прежний.`,
          `The daily payout limit was raised to ${limitText(restore.to)} so everyone could claim before the point price decrease (${t.moment(restore.effective_at)}). The decrease is in effect now, and the limit is the safety cap for a leaked bot key: set it back.`,
        )}
      </p>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          className="flex-1"
          busy={busy === "limit"}
          disabled={Boolean(busy) || (Boolean(wallet) && !isAdminWallet)}
          onClick={onRestore}
        >
          {wallet
            ? L(`Вернуть ${limitText(restore.from)}`, `Restore ${limitText(restore.from)}`)
            : L("Подключить кошелёк администратора пула", "Connect the pool admin wallet")}
        </Button>
        <Button variant="ghost" busy={busy === "dismiss"} disabled={Boolean(busy)} onClick={onDismiss}>
          {L("Оставить как есть", "Keep it")}
        </Button>
      </div>
      {poolAdmin && wallet && !isAdminWallet && (
        <p className="text-[12px] leading-snug text-danger">
          {L(
            `Лимит меняет только кошелёк администратора пула ${shortenAddress(poolAdmin, 5)}. Подключите его.`,
            `Only the pool admin wallet ${shortenAddress(poolAdmin, 5)} can change the limit. Connect it.`,
          )}
        </p>
      )}
    </Card>
  );
}

function PoolManager({ chatId }) {
  const initDataRaw = useInitDataRaw();
  const wallet = useTonAddress();
  const [tonConnectUI] = useTonConnectUI();
  const haptic = useHaptic();
  const t = useI18n();
  const { L } = t;
  const formatTon = (nanotons) => t.units(nanotons, 9);
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
  // `pending` and `success` are notice texts (bilingual(), see Notice).
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
    setNotice({
      kind: "info",
      text: bilingual("Транзакция ещё подтверждается в сети — нажмите «Обновить» через минуту.", "Still confirming on-chain — pull Refresh in a minute."),
    });
  }

  const activate = () =>
    run("activate", async () => {
      setNotice({ kind: "info", text: bilingual("Подтвердите активацию в кошельке.", "Confirm the activation in your wallet.") });
      await send({ to: info.master_address, amount: info.create_pool_ton, payload_b64: info.create_pool_body });
      await waitFor(
        (s) => s.active,
        bilingual("Разворачиваем пул…", "Deploying the pool…"),
        bilingual("Пул работает. Пополните его, чтобы начать награждать.", "The pool is live. Top it up to start rewarding."),
      );
    });

  const deposit = () =>
    run("deposit", async () => {
      setNotice({ kind: "info", text: bilingual("Готовим перевод…", "Preparing the transfer…") });
      const tx = await apiFetch("/api/deposit-voucher", {
        method: "POST",
        initDataRaw,
        body: { chatId, wallet, amount },
      });
      setNotice({
        kind: "info",
        text: (t) =>
          t.L(
            `Подтвердите в кошельке. ${t.units(tx.amount, 9)} TON — это газ сети, неизрасходованное вернётся.`,
            `Confirm in your wallet. The ${t.units(tx.amount, 9)} TON is network gas; what is not spent comes back.`,
          ),
      });
      await send(tx);
      const before = BigInt(info.ledger ?? 0);
      setAmount("");
      await waitFor(
        (s) => s.ledger !== null && BigInt(s.ledger) > before,
        bilingual("Отправлено — ждём зачисления в пул…", "Sent — waiting for the pool to credit it…"),
        bilingual("Пул пополнен.", "Pool topped up."),
      );
    });

  const claimAdmin = () =>
    run("admin", async () => {
      setNotice({ kind: "info", text: bilingual("Готовим чек админа…", "Preparing the admin voucher…") });
      const tx = await apiFetch("/api/admin-voucher", { method: "POST", initDataRaw, body: { chatId, wallet } });
      setNotice({ kind: "info", text: bilingual("Подтвердите в кошельке.", "Confirm in your wallet.") });
      await send(tx);
      await waitFor(
        (s) => sameAddress(s.pool_admin, wallet),
        bilingual("Назначаем этот кошелёк админом пула…", "Registering this wallet as pool admin…"),
        bilingual("Теперь вывод из пула управляется этим кошельком.", "This wallet now controls withdrawals."),
      );
    });

  const adminTx = (body) => apiFetch("/api/pool-admin-tx", { method: "POST", initDataRaw, body: { chatId, ...body } });

  const setPaused = (paused) =>
    run("pause", async () => {
      const tx = await adminTx({ action: paused ? "pause" : "resume" });
      setNotice({ kind: "info", text: bilingual("Подтвердите в кошельке.", "Confirm in your wallet.") });
      await send(tx);
      await waitFor(
        (s) => s.controls?.paused === paused,
        paused ? bilingual("Приостанавливаем вывод…", "Pausing claims…") : bilingual("Возобновляем вывод…", "Resuming claims…"),
        paused
          ? bilingual("Вывод приостановлен. Никто не сможет забрать баллы, пока вы его не возобновите.", "Claims are paused. Nobody can claim until you resume.")
          : bilingual("Вывод снова открыт.", "Claims are open again."),
      );
    });

  const saveLimit = (value) =>
    run("limit", async () => {
      const tx = await adminTx({ action: "limit", amount: value });
      setNotice({ kind: "info", text: bilingual("Подтвердите в кошельке.", "Confirm in your wallet.") });
      await send(tx);
      setLimitAmount("");
      const before = info.controls?.limit;
      await waitFor(
        (s) => s.controls && s.controls.limit !== before,
        bilingual("Меняем дневной лимит…", "Updating the daily limit…"),
        bilingual("Дневной лимит изменён.", "Daily limit updated."),
      );
    });

  // The daily limit raised from the price card for a decrease that is now
  // behind (pool-status `limit_restore`): back to what it was, or keep it.
  const restoreLimit = (restore) =>
    saveLimit(restore.from === "0" ? "0" : formatExact(restore.from, info.jetton?.decimals ?? null));

  const dismissRestore = async () => {
    setBusy("dismiss");
    try {
      await apiFetch("/api/limit-restore", { method: "POST", initDataRaw, body: { chatId } });
      await load();
    } catch (e) {
      haptic("error");
      setNotice({ kind: "err", text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const withdraw = () =>
    run("withdraw", async () => {
      const tx = await adminTx({ action: "withdraw", amount: withdrawAmount, to: wallet });
      setNotice({ kind: "info", text: bilingual("Подтвердите вывод в кошельке.", "Confirm the withdrawal in your wallet.") });
      await send(tx);
      const before = BigInt(info.ledger ?? 0);
      setWithdrawAmount("");
      await waitFor(
        (s) => s.ledger !== null && BigInt(s.ledger) < before,
        bilingual("Выводим…", "Withdrawing…"),
        bilingual("Жетоны уже в пути к вашему кошельку.", "Jettons are on their way to your wallet."),
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

  const symbol = info.jetton?.symbol || L("жетонов", "jetton");
  const decimals = info.jetton?.decimals ?? null;
  const isAdminWallet = sameAddress(info.pool_admin, wallet);

  return (
    <Screen>
      <TopBar />

      {info.network === "testnet" && (
        <div className="-mt-2 flex justify-center">
          <Chip tone="gold">{L("Тестнет — подключите тестнет-кошелёк", "Testnet — connect a testnet wallet")}</Chip>
        </div>
      )}

      <div className="flex items-center gap-3">
        <ChatAvatar title={info.title} id={info.chat_id} size={56} />
        <div className="min-w-0">
          <h1 className="brand-heading truncate text-[24px] leading-tight">
            {info.title || L(`Чат ${info.chat_id}`, `Chat ${info.chat_id}`)}
          </h1>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {info.active ? (
              <Chip tone="success" icon={<Check className="h-3.5 w-3.5" />}>
                {L("Пул активен", "Pool active")}
              </Chip>
            ) : (
              <Chip tone="neutral">{L("Не активирован", "Not activated")}</Chip>
            )}
            {info.jetton_master && <Chip>{symbol}</Chip>}
          </div>
        </div>
      </div>

      <Card>
        <p className="mono-label text-hint">{L("Пул наград", "Reward pool")}</p>
        <p className="brand-heading mt-2 text-[32px] leading-none tabular">
          {info.active ? t.units(info.ledger, decimals) : "0"}{" "}
          <span className="text-[17px] font-semibold text-hint">{symbol}</span>
        </p>
        <div className="mt-3 divide-y divide-[color:var(--separator)] border-t border-[color:var(--separator)]">
          {info.pool_address && (
            <Row label={L("Контракт пула", "Pool contract")}>{shortenAddress(info.pool_address, 5)}</Row>
          )}
          {info.member_count !== null && <Row label={L("Участники", "Members")}>{t.num(info.member_count)}</Row>}
          {info.active && (
            <Row label={L("Админ-кошелёк", "Admin wallet")}>
              {info.pool_admin ? shortenAddress(info.pool_admin, 5) : L("не задан", "not set")}
            </Row>
          )}
        </div>
      </Card>

      {info.is_creator && info.bot_cannot_post && (
        <Notice
          notice={{
            kind: "err",
            text: info.bot_cannot_post.reason
              ? L(
                  `Бот не может писать в ваш чат: ${info.bot_cannot_post.reason}. Объявления о цене балла и смене жетона туда не доходят — верните бота в чат и дайте ему право писать.`,
                  `The bot can't post in your chat: ${info.bot_cannot_post.reason}. Announcements about the point price and the jetton don't reach it — add the bot back and let it post.`,
                )
              : L(
                  "Бот не может писать в ваш чат. Объявления о цене балла и смене жетона туда не доходят — верните бота в чат и дайте ему право писать.",
                  "The bot can't post in your chat. Announcements about the point price and the jetton don't reach it — add the bot back and let it post.",
                ),
          }}
        />
      )}

      {info.is_creator && info.migrated && (
        <Notice
          notice={{
            kind: "info",
            text: L(
              "Чат стал супергруппой (у него новый id). Бот пишет туда, а баллы, пул и настройки остаются за прежним чатом" +
                (info.migrated.needs_review ? " — это должен проверить оператор платформы." : "."),
              "The chat was upgraded to a supergroup (it has a new id). The bot posts there, but its points, pool and settings stay with the old chat" +
                (info.migrated.needs_review ? " — a platform operator needs to review it." : "."),
            ),
          }}
        />
      )}

      {info.is_creator && info.limit_restore && (
        <LimitRestoreBanner
          restore={info.limit_restore}
          symbol={symbol}
          decimals={decimals}
          poolAdmin={info.pool_admin}
          wallet={wallet}
          busy={busy}
          onRestore={() => restoreLimit(info.limit_restore)}
          onDismiss={dismissRestore}
        />
      )}

      {info.is_creator && (
        <Link href={`/deposit/${chatId}/members`} className="block">
          <Card className="flex items-center gap-3 active:opacity-80">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--control-border)] text-fg">
              <Users className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="card-title">{L("Счета участников", "Member accounts")}</p>
              <p className="text-[13px] text-hint">
                {L("Кто сколько заработал, сколько причитается, история выплат", "Who earned what, what is owed, payout history")}
              </p>
            </div>
            <ChevronRight className="h-5 w-5 text-hint" />
          </Card>
        </Link>
      )}

      {!info.jetton_master && (
        <Notice
          notice={{
            kind: "info",
            text: L(
              "Сначала задайте жетон наград: отправьте в чат /jetton <адрес мастер-контракта>.",
              "Set the reward jetton first: send /jetton <master address> in the chat.",
            ),
          }}
        />
      )}

      {!info.is_creator && (
        <Notice notice={{ kind: "info", text: L("Управлять этим пулом может только создатель чата.", "Only the chat creator can manage this pool.") }} />
      )}

      {info.is_creator && !info.active && (
        <section className="space-y-2.5">
          <SectionHeader title={L("Активация", "Activate")} />
          <Card className="space-y-3">
            <p className="text-[15px] leading-snug text-hint">
              {L(
                `Разверните пул наград этого чата — контракт, из которого жетоны может вывести только вы (и участники по чекам, подписанным ботом). Разово: кошелёк отправит ${formatTon(info.create_pool_ton)} TON, ${formatTon(info.pool_reserve_ton)} TON останутся на контракте пула на оплату его хранения в сети, остальное за вычетом газа вернётся.`,
                `Deploy this chat's reward pool — a contract only you (and member claims signed by the bot) can move jettons out of. One-time: your wallet sends ${formatTon(info.create_pool_ton)} TON, ${formatTon(info.pool_reserve_ton)} TON stays on the pool contract to pay its network storage, and the rest comes back minus gas.`,
              )}
            </p>
            <Button className="w-full" busy={busy === "activate"} disabled={Boolean(busy)} onClick={activate}>
              {wallet ? L("Активировать пул", "Activate pool") : L("Подключить кошелёк", "Connect wallet")}
            </Button>
          </Card>
        </section>
      )}

      {info.is_creator && info.active && info.jetton_master && !info.pool_admin && (
        <section className="space-y-2.5">
          <SectionHeader
            title={L("Шаг 1 · Админ-кошелёк", "Step 1 · Admin wallet")}
            hint={L("Нужен до первого пополнения.", "Needed before the first top-up.")}
          />
          <Card className="space-y-3">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--control-border)] text-fg">
                <Shield className="h-5 w-5" />
              </div>
              <p className="text-[14px] leading-snug text-hint">
                {L(
                  "Назначьте подключённый кошелёк админом пула. Только он сможет выводить жетоны, задавать дневной лимит выплат и приостанавливать вывод, и только он сможет потом передать эту роль.",
                  "Register the connected wallet as the pool admin. Only it can withdraw, set the daily payout limit or pause claims, and only it can hand the role over later.",
                )}
              </p>
            </div>
            <Button className="w-full" busy={busy === "admin"} disabled={Boolean(busy)} onClick={claimAdmin}>
              {wallet ? L("Сделать этот кошелёк админом", "Make this wallet the admin") : L("Подключить кошелёк", "Connect wallet")}
            </Button>
          </Card>
        </section>
      )}

      {info.is_creator && info.active && info.jetton_master && info.pool_admin && (
        <section className="space-y-2.5">
          <SectionHeader
            title={L("Пополнение", "Top up")}
            hint={L("Из этого баланса участники забирают свои баллы.", "Members claim their points from this balance.")}
          />
          <Card className="space-y-3">
            <AmountField value={amount} onChange={setAmount} symbol={symbol} disabled={Boolean(busy)} />
            <Button
              className="w-full"
              busy={busy === "deposit"}
              disabled={Boolean(busy) || (wallet && !Number(amount))}
              onClick={deposit}
            >
              <ArrowDown className="h-4 w-4" />
              {wallet ? L("Пополнить пул", "Top up pool") : L("Подключить кошелёк", "Connect wallet")}
            </Button>
          </Card>
        </section>
      )}

      {info.is_creator && <Subscription chatId={chatId} initDataRaw={initDataRaw} />}

      {info.is_creator && info.jetton_master && <PointPrice chatId={chatId} initDataRaw={initDataRaw} />}

      {info.is_creator && info.jetton_master && <ClaimRules chatId={chatId} initDataRaw={initDataRaw} />}

      {info.is_creator && info.pool_admin && !isAdminWallet && (
        <Notice
          notice={{
            kind: "info",
            text: L(
              `Вывод и защита пула доступны кошельку ${shortenAddress(info.pool_admin, 5)}. Подключите его, чтобы ими пользоваться.`,
              `Withdrawals and safety controls belong to ${shortenAddress(info.pool_admin, 5)}. Connect that wallet to use them.`,
            ),
          }}
        />
      )}

      {isAdminWallet && info.controls && (
        <section className="space-y-2.5">
          <SectionHeader
            title={L("Защита в блокчейне", "On-chain protection")}
            hint={L(
              "Её соблюдает сам контракт пула — она действует, даже если ключ бота украдут.",
              "Enforced by the pool contract itself — holds even if the bot's key is stolen.",
            )}
          />
          <Card className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="card-title">
                  {info.controls.paused ? L("Вывод приостановлен", "Claims paused") : L("Вывод открыт", "Claims open")}
                </p>
                <p className="text-[13px] text-hint">
                  {info.controls.paused
                    ? L("Никто не сможет забрать баллы, пока вы не возобновите вывод.", "Nobody can claim until you resume.")
                    : L("Экстренная остановка всех выводов участников.", "Emergency stop for all member claims.")}
                </p>
              </div>
              <Button
                size="sm"
                variant={info.controls.paused ? "primary" : "danger"}
                busy={busy === "pause"}
                disabled={Boolean(busy)}
                onClick={() => setPaused(!info.controls.paused)}
              >
                {info.controls.paused ? L("Возобновить", "Resume") : L("Пауза", "Pause")}
              </Button>
            </div>
            <div className="divide-y divide-[color:var(--separator)] border-t border-[color:var(--separator)]">
              <Row label={L("Дневной лимит выплат", "Daily payout limit")}>
                {info.controls.limit === "0" ? L("10% пула", "10% of pool") : `${t.units(info.controls.limit, decimals)} ${symbol}`}
              </Row>
              <Row label={L("Осталось на сегодня", "Left today")}>
                {t.units(info.controls.claimable_today, decimals)} {symbol}
              </Row>
            </div>
            <AmountField
              value={limitAmount}
              onChange={setLimitAmount}
              symbol={L(`${symbol}/день`, `${symbol}/day`)}
              disabled={Boolean(busy)}
            />
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                busy={busy === "limit"}
                disabled={Boolean(busy) || !Number(limitAmount)}
                onClick={() => saveLimit(limitAmount)}
              >
                {L("Задать лимит", "Set limit")}
              </Button>
              {info.controls.limit !== "0" && (
                <Button variant="ghost" disabled={Boolean(busy)} onClick={() => saveLimit("0")}>
                  {L("Вернуть 10%", "Use 10%")}
                </Button>
              )}
            </div>
          </Card>
        </section>
      )}

      {isAdminWallet && info.jetton_master && (
        <section className="space-y-2.5">
          <SectionHeader title={L("Вывод из пула", "Withdraw")} hint={L("Заберите жетоны обратно из пула.", "Take jettons back from the pool.")} />
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
              {L("Вывести на мой кошелёк", "Withdraw to my wallet")}
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
        <Refresh className="h-4 w-4" /> {L("Обновить", "Refresh")}
      </button>
    </Screen>
  );
}

export default function DepositPage({ params }) {
  const { chatId } = use(params);
  return (
    <AppShell>
      <PoolManager chatId={Number(chatId)} />
    </AppShell>
  );
}
