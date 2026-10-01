"use client";

import { useCallback, useEffect, useState } from "react";
import { Address } from "@ton/core";
import { useTonAddress, useTonConnectUI } from "@tonconnect/ui-react";
import { apiFetch, sendTonTransaction, shortenAddress, sleep } from "@/lib/client-api";
import { formatDate, formatExact } from "@/lib/format";
import { intlLocale } from "@/lib/i18n";
import { compareDecimal, normalizePointPrice, priceFitsDecimals } from "@/lib/point-price";
import { formatUnits, pointsToJettons } from "@/lib/ton/amounts";
import { useI18n, useL } from "@/lib/use-locale";
import { Button, Card, Chip, Notice, SectionHeader, bilingual } from "./ui";
import { useHaptic } from "./AppShell";

const EXAMPLE_POINTS = 100;
const DAY_MS = 86400 * 1000;

// A precise moment in the viewer's time zone, with the zone named: the
// creator and the members may be in different ones.
function momentText(epochMs) {
  return new Date(epochMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

// "1 день / 2 дня / 5 дней" and "1 day / 2 days".
function daysText(L, n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const ru =
    mod10 === 1 && mod100 !== 11 ? "день" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "дня" : "дней";
  return L(`${n} ${ru}`, `${n} ${n === 1 ? "day" : "days"}`);
}

// One stretch of open claims before a decrease, in UTC like the claim rules:
// "Mon, Oct 5 00:00–23:59", "now – Wed, Oct 7 23:59". A window ending at a
// midnight is open through the day before's 23:59.
function windowText(t, w, nowSec) {
  const day = (sec) =>
    new Date(sec * 1000).toLocaleDateString(intlLocale(t.locale), {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  const hm = (sec) => new Date(sec * 1000).toISOString().slice(11, 16);
  const last = w.end % 86400 === 0 ? w.end - 60 : w.end;
  // the server clipped it at its "now": open already
  const openNow = w.start % 86400 !== 0 && w.start <= nowSec + 60;
  if (openNow) return `${t.L("сейчас", "now")} – ${day(last)} ${hm(last)}`;
  if (Math.floor(w.start / 86400) === Math.floor(last / 86400)) return `${day(w.start)} ${hm(w.start)}–${hm(last)}`;
  return `${day(w.start)} ${hm(w.start)} – ${day(last)} ${hm(last)}`;
}

const MAX_WINDOWS_SHOWN = 6;

// "Claims open: Mon, Oct 5 00:00–23:59, Thu, Oct 8 00:00–23:59 UTC" - exactly
// when members can claim at the current price (`windows` from the API, epoch
// seconds).
function ClaimWindows({ windows }) {
  const t = useI18n();
  const nowSec = Math.floor(Date.now() / 1000);
  const more = windows.length - MAX_WINDOWS_SHOWN;
  return (
    <p className="text-[13px] leading-snug text-hint tabular">
      {t.L("Вывод до снижения открыт:", "Claims open before then:")}{" "}
      <span className="font-semibold text-fg">
        {windows
          .slice(0, MAX_WINDOWS_SHOWN)
          .map((w) => windowText(t, w, nowSec))
          .join(", ")}
        {more > 0 ? t.L(` и ещё ${more}`, ` and ${more} more`) : ""} UTC
      </span>
    </p>
  );
}

function sameAddress(a, b) {
  try {
    return Boolean(a && b) && Address.parse(a).equals(Address.parse(b));
  } catch {
    return false;
  }
}

// normalizePointPrice() explains in English (the API uses the same check);
// the card says it in the viewer's language.
function invalidText(L, message) {
  if (/greater than 0/.test(message)) return L("Цена должна быть больше нуля.", "The price must be greater than 0.");
  const max = /at most (\d+) jettons/.exec(message);
  if (max) return L(`Не больше ${max[1]} за балл.`, `At most ${max[1]} per point.`);
  const dec = /has (\d+) decimals/.exec(message);
  if (dec) {
    return L(
      `У этого жетона ${dec[1]} знаков после запятой: в цене их может быть не больше.`,
      `This jetton has ${dec[1]} decimals: the price can have at most ${dec[1]} digits after the point.`,
    );
  }
  return L("Введите число, например 0.01.", 'Enter a decimal number, e.g. "0.01".');
}

// Whether the pool can pay every member before the decrease: its balance and
// its on-chain daily payout limit over the notice period (the server's
// `coverage`, see lib/payout-coverage.js). Only warns - the decrease can be
// scheduled either way - and offers the pool admin's "limit" transaction when
// the limit is what falls short. `state` ({ coverage, coverage_error }) lives
// in the card so typing a price back and forth does not re-check the chain.
function PayoutCoverage({ chatId, initDataRaw, symbol, state, setState }) {
  const L = useL();
  const t = useI18n();
  const haptic = useHaptic();
  const wallet = useTonAddress();
  const [tonConnectUI] = useTonConnectUI();
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (state || !initDataRaw) return undefined;
    let alive = true;
    apiFetch(`/api/point-price?chatId=${chatId}&coverage=1`, { initDataRaw })
      .then((res) => alive && setState({ coverage: res.coverage, coverage_error: res.coverage_error }))
      .catch((e) => alive && setState({ coverage: null, coverage_error: e.message }));
    return () => {
      alive = false;
    };
  }, [state, setState, chatId, initDataRaw]);

  if (!state) {
    return (
      <p className="text-[12px] leading-snug text-hint">
        {L("Проверяем, хватит ли пула…", "Checking whether the pool covers it…")}
      </p>
    );
  }
  const coverage = state.coverage;
  if (!coverage) {
    return state.coverage_error ? (
      <p className="text-[12px] leading-snug text-hint">
        {L("Не удалось проверить, хватит ли пула:", "Could not check whether the pool covers it:")}{" "}
        {state.coverage_error}
      </p>
    ) : null;
  }

  const cDec = coverage.decimals ?? null;
  // the same grouping as the rest of the page ("5 230,5" in Russian)
  const amount = (units) => `${t.units(units, cDec)} ${symbol}`;
  const suggested = formatExact(coverage.suggested_daily_limit, cDec);
  const isAdminWallet = coverage.pool_admin ? sameAddress(coverage.pool_admin, wallet) : false;
  const limitRaisable = !coverage.enough_limit && BigInt(coverage.suggested_daily_limit) > BigInt(coverage.daily_limit);

  // The pool's own "limit" transaction (as on the pool page): only the pool
  // admin wallet can send it. The card keeps the price being typed.
  async function raiseLimit() {
    if (!wallet) {
      tonConnectUI.openModal();
      return;
    }
    if (!isAdminWallet) return;
    const target = coverage.suggested_daily_limit;
    setBusy("limit");
    setNotice(null);
    try {
      const tx = await apiFetch("/api/pool-admin-tx", {
        method: "POST",
        initDataRaw,
        // recorded, so the pool page reminds the admin to set it back
        body: { chatId, action: "limit", amount: suggested, purpose: "price_notice" },
      });
      setNotice({ kind: "info", text: bilingual("Подтвердите в кошельке.", "Confirm in your wallet.") });
      await sendTonTransaction(tonConnectUI, coverage.network, [
        { address: tx.to, amount: tx.amount, payload: tx.payload_b64 },
      ]);
      setNotice({ kind: "info", text: bilingual("Меняем дневной лимит…", "Updating the daily limit…") });
      for (let i = 0; i < 24; i++) {
        await sleep(5000);
        const res = await apiFetch(`/api/point-price?chatId=${chatId}&coverage=1`, { initDataRaw }).catch(() => null);
        if (res?.coverage && !res.coverage.daily_limit_is_default && res.coverage.daily_limit === target) {
          setState({ coverage: res.coverage, coverage_error: res.coverage_error });
          haptic("success");
          setNotice({
            kind: "ok",
            text: (t) =>
              t.L(
                `Дневной лимит выплат: ${t.units(target, cDec)} ${symbol}. После снижения цены пульт пула напомнит вернуть прежний.`,
                `Daily payout limit is now ${t.units(target, cDec)} ${symbol}. After the decrease the pool page reminds you to set it back.`,
              ),
          });
          return;
        }
      }
      setNotice({
        kind: "info",
        text: bilingual(
          "Ещё подтверждается в сети — обновите страницу через минуту.",
          "Still confirming on-chain — reload in a minute.",
        ),
      });
    } catch (e) {
      haptic("error");
      setNotice({ kind: "err", text: e.message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2 rounded-xl bg-bg p-3">
      <p className="text-[13px] font-semibold">
        {L("Успеют ли все забрать баллы до снижения?", "Can everyone claim before the decrease?")}
      </p>
      <ul className="space-y-1 text-[13px] tabular">
        <li className="flex justify-between gap-3">
          <span className="text-hint">{L("Участникам причитается", "Owed to members")}</span>
          <span className="font-semibold">{amount(coverage.debt)}</span>
        </li>
        <li className="flex justify-between gap-3">
          <span className="text-hint">{L("В пуле", "In the pool")}</span>
          <span className={coverage.enough_balance ? "" : "font-semibold text-danger"}>
            {amount(coverage.pool_balance)}
          </span>
        </li>
        <li className="flex justify-between gap-3">
          <span className="text-hint">
            {coverage.daily_limit_is_default
              ? L("Лимит в день (10% пула)", "Daily limit (10% of pool)")
              : L("Лимит в день", "Daily limit")}
          </span>
          <span>{amount(coverage.daily_limit)}</span>
        </li>
        <li className="flex justify-between gap-3">
          <span className="text-hint">
            {L(
              `Лимит выпустит за ${daysText(L, coverage.notice_days)}`,
              `The limit lets out in ${daysText(L, coverage.notice_days)}`,
            )}
          </span>
          <span className={coverage.enough_limit ? "" : "font-semibold text-danger"}>{amount(coverage.capacity)}</span>
        </li>
      </ul>
      <p className="text-[12px] leading-snug text-hint">
        {L(
          "Это оценка с запасом: пополнения пула за это время не учтены, а с лимитом 10% считаем, что пул каждый день выплачивает весь лимит и тает, — на деле обычно выйдет больше.",
          "A cautious estimate: top-ups during the notice are not counted, and with the 10% default the pool is assumed to pay its full budget every day and shrink — in practice more usually gets out.",
        )}
      </p>
      <p className="text-[12px] leading-snug text-hint">
        {L(
          "Считаем все невыплаченные баллы по текущей цене, в том числе ещё созревающие: их всё равно выплатят позже по цене до снижения. Учитываем только дни, когда вывод открыт.",
          "All unclaimed points at the current price, maturing ones included: they will be paid later at the pre-decrease price anyway. Only days with claims open count.",
        )}
      </p>

      {coverage.claims_paused && (
        <Notice
          notice={{
            kind: "err",
            text: L(
              "Выплаты остановлены в контракте пула (аварийная пауза администратора): пока пауза, никто не сможет забрать баллы. Снимите её на пульте пула.",
              "Claims are stopped in the pool contract (the admin's emergency pause): nobody can claim until it is lifted on the pool page.",
            ),
          }}
        />
      )}

      {!coverage.enough_balance && (
        <Notice
          notice={{
            kind: "err",
            text: L(
              `В пуле ${amount(coverage.pool_balance)}, а участникам по текущей цене причитается ${amount(coverage.debt)}: заплатить всем пул не сможет. Сначала пополните его.`,
              `The pool holds ${amount(coverage.pool_balance)} but members are owed ${amount(coverage.debt)} at the current price: it cannot pay everyone. Top it up first.`,
            ),
          }}
        />
      )}

      {!coverage.enough_limit && (
        <div className="space-y-2">
          <Notice
            notice={{
              kind: coverage.enough_balance ? "info" : "err",
              text: L(
                `С лимитом ${amount(coverage.daily_limit)} в день до снижения выйдет не больше ${amount(coverage.capacity)} — меньше, чем причитается участникам. Остальные получат уже по новой цене.`,
                `At ${amount(coverage.daily_limit)} a day, at most ${amount(coverage.capacity)} can go out before the decrease — less than members are owed. The rest would be paid at the new price.`,
              ),
            }}
          />
          {limitRaisable && (
            <>
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                busy={busy === "limit"}
                disabled={Boolean(busy) || (Boolean(wallet) && !isAdminWallet)}
                onClick={raiseLimit}
              >
                {wallet
                  ? L(
                      `Поднять дневной лимит до ${amount(coverage.suggested_daily_limit)}`,
                      `Raise daily limit to ${amount(coverage.suggested_daily_limit)}`,
                    )
                  : L("Подключить кошелёк администратора пула", "Connect the pool admin wallet")}
              </Button>
              {coverage.pool_admin && wallet && !isAdminWallet && (
                <p className="text-[12px] leading-snug text-danger">
                  {L(
                    `Лимит меняет только кошелёк администратора пула ${shortenAddress(coverage.pool_admin, 5)}. Подключите его.`,
                    `Only the pool admin wallet ${shortenAddress(coverage.pool_admin, 5)} can change the limit. Connect it.`,
                  )}
                </p>
              )}
              {!coverage.pool_admin && (
                <p className="text-[12px] leading-snug text-danger">
                  {L(
                    "У пула ещё нет кошелька администратора: назначьте его на пульте пула.",
                    "The pool has no admin wallet yet: set one on the pool page.",
                  )}
                </p>
              )}
              <p className="text-[12px] leading-snug text-hint">
                {L(
                  "Дневной лимит — защита на случай утечки ключа бота: чем он выше, тем больше можно вывести из пула за день. После снижения цены пульт пула напомнит вернуть прежний лимит.",
                  "The daily limit is the safety cap for a leaked bot key: the higher it is, the more could be moved out of the pool per day. After the decrease the pool page reminds you to set it back.",
                )}
              </p>
            </>
          )}
        </div>
      )}

      {coverage.enough_balance && coverage.enough_limit && !coverage.claims_paused && (
        <p className="text-[13px] leading-snug text-success">
          {L("Пул успеет выплатить всем до снижения.", "The pool can pay everyone before the decrease.")}
        </p>
      )}
      <p className="text-[12px] leading-snug text-hint">
        {L("Снижение можно запланировать в любом случае.", "You can schedule the decrease either way.")}
      </p>
      <Notice notice={notice} />
    </div>
  );
}

// The chat's own price of a point (jettons per point), off-chain like the
// claim rules: the bot sizes every claim voucher with it. Members see each
// change on their dashboard, so the card says so before saving. A lower
// price waits the notice period (the server decides; this card explains it)
// so members can claim at the current one first - and the card checks that
// the pool can actually pay them all in that time (balance and daily limit).
export function PointPrice({ chatId, initDataRaw }) {
  const L = useL();
  const haptic = useHaptic();
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  // payout coverage for the decrease (see PayoutCoverage): null until known
  const [coverage, setCoverage] = useState(null);

  const apply = useCallback((res) => {
    setData(res);
    setDraft(res.price ?? "");
    // computed by the server while a decrease is pending; otherwise fetched
    // when a decrease is typed
    setCoverage(
      res.coverage || res.coverage_error ? { coverage: res.coverage, coverage_error: res.coverage_error } : null,
    );
  }, []);

  const load = useCallback(async () => {
    if (!initDataRaw) return;
    try {
      apply(await apiFetch(`/api/point-price?chatId=${chatId}`, { initDataRaw }));
    } catch (e) {
      setNotice({ kind: "err", text: e.message });
    }
  }, [apply, chatId, initDataRaw]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) return notice ? <Notice notice={notice} /> : null;

  const symbol = data.jetton?.symbol || L("жетонов", "jetton");
  // Same validation the server applies, so the example never shows a price
  // it would refuse.
  let price = null;
  let invalid = null;
  // "0." is a price still being typed, not an error
  if (draft.trim() && !draft.endsWith(".")) {
    try {
      price = normalizePointPrice(draft, data.decimals_known ? data.decimals : null);
    } catch (e) {
      invalid = invalidText(L, e.message);
    }
  }
  const pending = data.pending;
  const noticeDays = data.notice_days ?? 0;
  // Re-saving the decrease already scheduled would only restart its notice.
  const alreadyScheduled = pending && !pending.to_default && price === pending.price;
  const dirty = price !== null && price !== data.price && !alreadyScheduled;
  const lowering = dirty && data.price !== null && compareDecimal(price, data.price) < 0;
  // "Use default" is a decrease too when the default is (or is heading)
  // lower: it is scheduled to where the default is heading.
  const platformTarget = data.platform_target ?? data.platform_price;
  const resetLowers = data.custom && data.price !== null && compareDecimal(platformTarget, data.price) < 0;
  const example =
    price !== null ? formatUnits(pointsToJettons(EXAMPLE_POINTS, price, data.decimals), data.decimals) : null;
  // A decrease requested now (the server's preview): when it would apply,
  // extended so members get a full claim day under the claim rules, and the
  // windows they get; effective_at null: claims are paused with no end date.
  const next = data.next_decrease ?? null;
  const blocked = noticeDays > 0 && next !== null && next.effective_at === null;
  const blockedText = L(
    "Вывод в этом чате приостановлен без даты возобновления: до снижения участники не смогли бы забрать баллы по текущей цене, поэтому запланировать его нельзя. Возобновите вывод или задайте дату возобновления в «Правилах вывода» ниже.",
    "Claims in this chat are paused with no end date: members could not claim at the current price before a decrease, so none can be scheduled. Resume claims or set a resume date in Claim rules below.",
  );
  // The server's date when known; else the client clock's estimate.
  const scheduledFor = next?.effective_at
    ? momentText(next.effective_at * 1000)
    : momentText(Date.now() + noticeDays * DAY_MS);
  const replaces = pending
    ? L(" Оно заменит уже запланированное снижение.", " It replaces the decrease already scheduled.")
    : "";
  const when = next?.extended
    ? L(
        `Более низкая цена вступит в силу ${scheduledFor}: срок предупреждения — ${daysText(L, noticeDays)}, но по правилам вывода (дни вывода по UTC или пауза) в этот срок не попадает ни одного полного дня вывода, поэтому снижение ждёт, пока он у участников будет.`,
        `A lower price takes effect on ${scheduledFor}: the notice is ${daysText(L, noticeDays)}, but the claim rules (claim days in UTC, or a pause) leave no full claim day in it, so it waits until members have had one.`,
      )
    : L(
        `Более низкая цена вступит в силу через ${daysText(L, noticeDays)}, примерно ${scheduledFor}.`,
        `A lower price takes effect after ${daysText(L, noticeDays)}, on about ${scheduledFor}.`,
      );
  const decreaseText =
    noticeDays > 0
      ? `${when} ${L(
          `До тех пор участники могут забрать баллы по цене 1 балл = ${data.price} ${symbol}; бот объявит о снижении в чате сейчас и ещё раз, когда оно вступит в силу. Баллы, которые к тому моменту ещё не созреют, будут выплачены по текущей цене.${replaces}`,
          `Until then members can still claim at 1 point = ${data.price} ${symbol}; the bot announces the decrease in the chat now and again when it applies. Points still maturing by then will be paid at the current price.${replaces}`,
        )}`
      : L(
          "Более низкая цена уменьшит и стоимость баллов, которые у участников уже есть. Она вступит в силу сразу, бот объявит об этом в чате.",
          "A lower price also lowers the value of points members already hold. It applies right away and the bot announces it in the chat.",
        );

  // Can members claim everything before the decrease?
  const showCoverage = (lowering && noticeDays > 0) || Boolean(pending);

  // The notice after a save, drawn in the language shown at the time (see
  // Notice): called with that language's L.
  function savedText(L, res, lowered, next) {
    const unsent =
      res.announced === false
        ? L(
            " Бот не смог получить задание: объявите об этом в чате сами.",
            " The bot could not be told: announce it in the chat yourself.",
          )
        : "";
    if (lowered && res.pending) {
      // the "will drop" announcement is queued again on the next read, and
      // by the bot itself within minutes
      const late =
        res.announced === false
          ? L(
              " Бот получит задание с задержкой, в течение нескольких минут.",
              " The bot gets it with a delay, within a few minutes.",
            )
          : "";
      return L(
        `Снижение запланировано на ${momentText(res.pending.effective_at * 1000)}. Бот объявит о нём в чате.${late}`,
        `Decrease scheduled for ${momentText(res.pending.effective_at * 1000)}. The bot announces it in the chat.${late}`,
      );
    }
    if (next === null)
      return L(`Снова цена платформы по умолчанию.${unsent}`, `Back to the platform default.${unsent}`);
    return L(`Цена балла сохранена.${unsent}`, `Point price saved.${unsent}`);
  }

  // `onDone(res)` gives the success notice's text (see Notice).
  async function post(body, action, onDone) {
    setBusy(action);
    setNotice(null);
    try {
      const res = await apiFetch("/api/point-price", { method: "POST", initDataRaw, body: { chatId, ...body } });
      apply(res);
      haptic("success");
      setNotice({ kind: "ok", text: onDone(res) });
    } catch (e) {
      haptic("error");
      setNotice({ kind: "err", text: e.message });
    } finally {
      setBusy(null);
    }
  }

  function save(next, action, lowered) {
    return post({ price: next }, action, (res) => ({ L }) => savedText(L, res, lowered, next));
  }

  function confirmDefault() {
    return post({ confirmDefault: true }, "confirm", () =>
      bilingual("Остаётся цена платформы по умолчанию.", "The platform default stays."),
    );
  }

  function cancelPending() {
    return post({ cancelPending: true }, "cancel", (res) =>
      res.announced === false
        ? bilingual(
            "Снижение отменено. Бот не смог получить задание: сообщите чату сами.",
            "Decrease cancelled. The bot could not be told: let the chat know yourself.",
          )
        : bilingual(
            "Снижение отменено. Бот сообщит чату, что цена остаётся.",
            "Decrease cancelled. The bot tells the chat the price stays.",
          ),
    );
  }

  return (
    <section className="space-y-2.5">
      <SectionHeader
        title={L("Цена балла", "Point price")}
        hint={L(
          "Сколько платит один балл. Менять бесплатно; повышение действует со следующей выплаты, снижение — после срока предупреждения.",
          "What one point pays out. Free to change; a raise applies to the next claim, a cut after a notice period.",
        )}
      />
      <Card className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <p className="card-title">{L("1 балл =", "1 point =")}</p>
            <Chip>
              {data.custom ? L("ваша цена", "your price") : L("по умолчанию", "platform default")}
            </Chip>
          </div>
          <div className="flex h-12 items-center gap-2 rounded-xl bg-bg px-3.5 ring-accent focus-within:ring-2">
            <input
              className="min-w-0 flex-1 bg-transparent text-[17px] font-semibold tabular outline-none placeholder:font-normal placeholder:text-hint"
              inputMode="decimal"
              placeholder={data.platform_price}
              aria-label={L(`${symbol} за балл`, `${symbol} per point`)}
              value={draft}
              disabled={Boolean(busy)}
              onChange={(e) => setDraft(e.target.value.replace(",", ".").replace(/[^\d.]/g, ""))}
            />
            <span className="text-[15px] font-medium text-hint">{symbol}</span>
          </div>
          <p className="text-[13px] leading-snug text-hint tabular">
            {invalid ? (
              <span className="text-danger">{invalid}</span>
            ) : example !== null ? (
              <>
                {L(`${EXAMPLE_POINTS} баллов =`, `${EXAMPLE_POINTS} points =`)}{" "}
                <span className="font-semibold text-fg">
                  {example} {symbol}
                </span>
              </>
            ) : (
              L("Введите, сколько жетонов стоит один балл.", "Enter how many jettons one point is worth.")
            )}
          </p>
          <p className="text-[13px] leading-snug text-hint tabular">
            {L("По умолчанию на платформе:", "Platform default:")} {L("1 балл", "1 point")} = {data.platform_price}{" "}
            {symbol}
            {data.platform_pending &&
              L(
                `, с ${momentText(data.platform_pending.effective_at * 1000)} — ${data.platform_pending.price} ${symbol}`,
                `, ${data.platform_pending.price} ${symbol} from ${momentText(data.platform_pending.effective_at * 1000)}`,
              )}
            {!data.decimals_known &&
              L(
                " · знаков после запятой у жетона пока не узнать, проверим при выплате",
                " · jetton decimals unknown, checked again at claim time",
              )}
          </p>
        </div>

        {data.confirm_required && (
          <div className="space-y-2 rounded-xl bg-bg p-3">
            <p className="text-[13px] font-semibold">{L("Жетон наград сменился", "The reward jetton changed")}</p>
            <p className="text-[13px] leading-snug text-hint tabular">
              {L(
                `Прежняя цена${data.confirm_required.old_price ? ` (${data.confirm_required.old_price} за балл)` : ""} была в старом жетоне, поэтому теперь действует цена платформы по умолчанию. Задайте цену в новом жетоне или оставьте цену по умолчанию.`,
                `The old price${data.confirm_required.old_price ? ` (${data.confirm_required.old_price} per point)` : ""} was in the old jetton, so the platform default applies now. Set a price in the new jetton, or keep the platform default.`,
              )}
            </p>
            <Button variant="ghost" size="sm" busy={busy === "confirm"} disabled={Boolean(busy)} onClick={confirmDefault}>
              {L("Оставить по умолчанию", "Keep the default")}
            </Button>
          </div>
        )}

        {pending && (
          <div className="space-y-2 rounded-xl bg-bg p-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[13px] font-semibold">
                {pending.platform
                  ? L("Платформа снижает цену по умолчанию", "The platform default goes down")
                  : L("Снижение запланировано", "Decrease scheduled")}
              </p>
              <span className="shrink-0 whitespace-nowrap">
                <Chip tone="gold">{momentText(pending.effective_at * 1000)}</Chip>
              </span>
            </div>
            <p className="text-[13px] leading-snug text-hint tabular">
              {L("1 балл", "1 point")} = {pending.from ?? data.price} →{" "}
              <span className="font-semibold text-fg">{pending.price}</span> {symbol}
              {pending.to_default ? L(" (цена по умолчанию)", " (platform default)") : ""}.{" "}
              {pending.platform
                ? L(
                    "Чат на цене по умолчанию, поэтому снижение касается и его. Участники видят это на своём экране, бот объявляет об этом в чате; до этого момента они забирают баллы по текущей цене. Чтобы цена не менялась, задайте свою.",
                    "The chat is on the platform default, so the decrease applies to it too. Members see it on their dashboard and the bot announces it in the chat; until then they claim at the current price. Set your own price to keep it.",
                  )
                : L(
                    "Участники видят это на своём экране, бот объявил об этом в чате; до этого момента они забирают баллы по текущей цене.",
                    "Members see it on their dashboard and the bot announced it in the chat; until then they claim at the current price.",
                  )}
            </p>
            {!pending.claims_open_throughout && pending.claim_windows?.length > 0 && (
              <ClaimWindows windows={pending.claim_windows} />
            )}
            {!pending.platform && (
              <Button variant="ghost" size="sm" busy={busy === "cancel"} disabled={Boolean(busy)} onClick={cancelPending}>
                {L("Отменить снижение", "Cancel decrease")}
              </Button>
            )}
          </div>
        )}

        {pending && data.decimals_known && !priceFitsDecimals(pending.price, data.decimals) && (
          <Notice
            notice={{
              kind: "err",
              text: L(
                `У жетона теперь ${data.decimals} знаков после запятой: ${pending.price} ${symbol} за балл мельче его наименьшей единицы, и после снижения выплаты будут отклоняться. Отмените его или запланируйте цену покрупнее.`,
                `The jetton now has ${data.decimals} decimals: ${pending.price} ${symbol} per point is finer than its smallest unit, so claims will be refused once this decrease applies. Cancel it or schedule a coarser price.`,
              ),
            }}
          />
        )}

        {lowering && !blocked && <Notice notice={{ kind: "info", text: decreaseText }} />}
        {lowering && !blocked && noticeDays > 0 && next && !next.claims_open_throughout && next.claim_windows.length > 0 && (
          <ClaimWindows windows={next.claim_windows} />
        )}
        {lowering && blocked && <Notice notice={{ kind: "err", text: blockedText }} />}
        {pending && !pending.platform && dirty && !lowering && (
          <p className="text-[13px] leading-snug text-hint">
            {L(
              "Если сохранить эту цену, запланированное снижение отменится.",
              "Saving this price cancels the scheduled decrease.",
            )}
          </p>
        )}
        {alreadyScheduled && (
          <p className="text-[13px] leading-snug text-hint">
            {L("Это снижение уже запланировано.", "This decrease is already scheduled.")}
          </p>
        )}
        {pending && pending.claim_windows?.length === 0 && (
          <Notice
            notice={{
              kind: "err",
              text: L(
                "До снижения вывод в этом чате больше не откроется: участники не смогут забрать баллы по текущей цене. Откройте вывод в «Правилах вывода» ниже или отмените снижение.",
                "Claims in this chat don't open again before the decrease: members can't claim at the current price. Open claims in Claim rules below or cancel the decrease.",
              ),
            }}
          />
        )}

        {showCoverage && (
          <PayoutCoverage
            chatId={chatId}
            initDataRaw={initDataRaw}
            symbol={symbol}
            state={coverage}
            setState={setCoverage}
          />
        )}

        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            busy={busy === "save"}
            disabled={Boolean(busy) || !dirty || (lowering && blocked)}
            onClick={() => save(price, "save", lowering)}
          >
            {lowering && noticeDays > 0
              ? L("Запланировать снижение", "Schedule decrease")
              : L("Сохранить цену", "Save price")}
          </Button>
          {data.custom && !pending?.to_default && (
            <Button
              variant="ghost"
              busy={busy === "reset"}
              disabled={Boolean(busy) || (resetLowers && blocked)}
              onClick={() => save(null, "reset", resetLowers)}
            >
              {L("По умолчанию", "Use default")}
            </Button>
          )}
        </div>
        {data.custom && resetLowers && noticeDays > 0 && !pending?.to_default && (
          <p className="text-[13px] leading-snug text-hint">
            {L(
              `Цена по умолчанию (${platformTarget} ${symbol}) ниже вашей, так что возврат к ней — тоже снижение: оно тоже ждёт ${daysText(L, noticeDays)}.`,
              `The default (${platformTarget} ${symbol}) is lower than your price, so going back to it is a decrease: it waits ${daysText(L, noticeDays)} too.`,
            )}
          </p>
        )}

        {data.history.length > 0 && (
          <div className="space-y-1.5 border-t border-[color:var(--separator)] pt-3">
            <p className="text-[13px] font-semibold text-hint">
              {L("Последние изменения · видны участникам", "Recent changes · visible to members")}
            </p>
            <ul className="space-y-1 text-[13px] tabular">
              {data.history.slice(0, 3).map((h, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="text-hint">{formatDate(h.at)}</span>
                  {/* the old price was in the old jetton: no "old → new" */}
                  {h.reason === "jetton_changed" ? (
                    <span>{L("Жетон наград сменился", "Reward jetton changed")}</span>
                  ) : (
                    <span>
                      {h.old} → {h.new} {symbol}
                      {h.reason === "platform_default" ? L(" · платформа", " · platform default") : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <Notice notice={notice} />
      </Card>
    </section>
  );
}
