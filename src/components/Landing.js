import Link from "next/link";
import { getTonConfig } from "@/lib/ton/config";
import { GAS } from "@/lib/ton/constants";
import {
  ArrowDown,
  Check,
  Clock,
  Coins,
  Gift,
  Info,
  Lock,
  Medal,
  Pool,
  Search,
  Shield,
  Sparkles,
  Users,
} from "./icons";
import { LangSwitch } from "./LangSwitch";

// Landing page for visitors from the web: what Achivator gives a chat owner,
// how the money flows, what it costs and what is guaranteed by the contracts
// versus by trust in the service. A server component rendered once per
// locale, at /ru and /en (see lib/locale.js); every text sits next to its
// translation via L(ru, en). Numbers come from the same config the API uses,
// so the page cannot promise a rate or an amount the backend does not apply.

const APP_URL = "https://t.me/achivator_bot/app";
const ADD_TO_GROUP_URL = "https://t.me/achivator_bot?startgroup=true";
const GITHUB_URL = "https://github.com/achivator";
const CHANNEL_URL = "https://t.me/achivator";

// Anti-farming defaults of the bot (telegram-bot/index.mjs, claim-rules.js).
const MIN_REACTOR_MESSAGES = 5;
const PAIR_DAILY_CAP = 5;
const RECEIVER_DAILY_CAP = 200;
const CREATOR_MULTIPLIER = 10;
const MATURATION_DAYS = 3;
const DAILY_LIMIT_PERCENT = 10;

const MEDALS = ["programmer", "night owl", "voicy", "on fire", "santa", "sticker", "telescope", "loved"];

function Eyebrow({ children }) {
  return <p className="text-[13px] font-semibold uppercase tracking-wide text-accent">{children}</p>;
}

function Section({ id, eyebrow, title, lead, children }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-6 py-10 md:py-14">
      <div className="max-w-2xl space-y-2">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h2 className="text-[26px] font-bold leading-tight tracking-tight text-balance md:text-[32px]">{title}</h2>
        {lead && <p className="text-[16px] leading-relaxed text-hint">{lead}</p>}
      </div>
      {children}
    </section>
  );
}

function Panel({ className = "", children }) {
  return (
    <div className={`rounded-card bg-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${className}`}>{children}</div>
  );
}

function IconTile({ tone = "tint-accent text-accent", children }) {
  return (
    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>{children}</div>
  );
}

function Benefit({ icon, title, children }) {
  return (
    <Panel className="space-y-3">
      <IconTile>{icon}</IconTile>
      <h3 className="text-[17px] font-bold leading-snug">{title}</h3>
      <p className="text-[15px] leading-relaxed text-hint">{children}</p>
    </Panel>
  );
}

function Cmd({ children }) {
  return (
    <code className="rounded-md bg-bg px-1.5 py-0.5 font-mono text-[13px] text-fg [overflow-wrap:anywhere]">{children}</code>
  );
}

function Ext({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-link underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

function PrimaryCta({ href, children }) {
  return (
    <Link
      href={href}
      className="inline-flex h-12 items-center justify-center rounded-xl bg-accent px-6 text-[15px] font-semibold text-accent-fg transition active:scale-[0.98] active:opacity-85"
    >
      {children}
    </Link>
  );
}

function SecondaryCta({ href, children }) {
  return (
    <a
      href={href}
      className="tint-accent inline-flex h-12 items-center justify-center rounded-xl px-6 text-[15px] font-semibold text-accent transition active:scale-[0.98] active:opacity-85"
    >
      {children}
    </a>
  );
}

// ---- Hero: what a member sees, in one glance ----

function ChatMock({ L, fmt, rate }) {
  const month = 900;
  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[40px] opacity-60 blur-2xl hero-gradient" />
      <div className="space-y-3 rounded-[26px] bg-surface p-4 shadow-xl ring-1 ring-black/5">
        <div className="flex items-center gap-2 border-b border-[color:var(--separator)] pb-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-[15px] font-semibold text-white">
            F
          </span>
          <div className="leading-tight">
            <p className="text-[15px] font-semibold">{L("Клуб фронтендеров", "Frontend Club")}</p>
            <p className="text-[12px] text-hint">{L("800 участников", "800 members")}</p>
          </div>
        </div>

        <div className="flex items-end gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-400 to-violet-500 text-[13px] font-semibold text-white">
            {L("А", "A")}
          </span>
          <div className="rounded-2xl rounded-bl-md bg-bg px-3 py-2">
            <p className="text-[13px] font-semibold text-link">{L("Аня", "Anna")}</p>
            <p className="text-[14px] leading-snug">
              {L(
                "Держи рабочий конфиг vite + vitest, у меня завелось с первого раза 👇",
                "Here is a working vite + vitest config, it ran first try for me 👇",
              )}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[12px] font-medium">
              <span className="tint-accent rounded-full px-2 py-0.5 text-accent">👍 9</span>
              <span className="tint-accent rounded-full px-2 py-0.5 text-accent">🔥 4</span>
              <span className="tint-accent rounded-full px-2 py-0.5 text-accent">🙏 1</span>
            </div>
          </div>
        </div>

        <div className="flex justify-center">
          <span className="tint-success rounded-full px-3 py-1 text-[12px] font-semibold text-success">
            {L("+14 баллов Ане за полезный ответ", "+14 points to Anna for a helpful answer")}
          </span>
        </div>

        <div className="hero-gradient flex items-center gap-3 rounded-2xl p-3">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] opacity-80">{L("Аня · за месяц", "Anna · this month")}</p>
            <p className="text-[20px] font-bold leading-tight tabular">
              {fmt(month)} {L("баллов", "points")}{" "}
              <span className="text-[14px] font-semibold opacity-85">≈ {fmt(month * rate)} FRONT</span>
            </p>
          </div>
          <span className="rounded-xl bg-white/25 px-3 py-2 text-[13px] font-semibold">{L("Забрать", "Claim")}</span>
        </div>
      </div>
    </div>
  );
}

// ---- The scheme: where jettons, points and TON go ----

function Node({ icon, title, children, className = "" }) {
  return (
    <div className={`rounded-2xl bg-surface p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-[color:var(--separator)] ${className}`}>
      <div className="flex items-center gap-2.5">
        {icon}
        <p className="font-bold leading-tight">{title}</p>
      </div>
      <div className="mt-1.5 text-[14px] leading-snug text-hint">{children}</div>
    </div>
  );
}

function Flow({ children }) {
  return (
    <div className="flex items-center justify-center gap-1.5 py-2 text-[13px] font-medium text-accent">
      <ArrowDown className="h-4 w-4 shrink-0" />
      <span className="text-center">{children}</span>
    </div>
  );
}

function Scheme({ L }) {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="grid grid-cols-2 gap-3">
        <Node icon={<IconTile><Coins className="h-5 w-5" /></IconTile>} title={L("Вы", "You")}>
          {L(
            "Выпускаете жетон сообщества и решаете, сколько положить в пул",
            "Issue a community jetton and decide how much goes into the pool",
          )}
        </Node>
        <Node icon={<IconTile><Users className="h-5 w-5" /></IconTile>} title={L("Чат и бот", "Chat and bot")}>
          {L("Участники ставят 👍 ❤ 🔥, бот превращает их в баллы", "Members react 👍 ❤ 🔥, the bot turns that into points")}
        </Node>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Flow>{L("жетоны", "jettons")}</Flow>
        <Flow>{L("подписанный чек на выплату", "signed payout voucher")}</Flow>
      </div>
      <Node
        icon={
          <div className="hero-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
            <Pool className="h-5 w-5" />
          </div>
        }
        title={L("Пул вашего чата — смарт-контракт в TON", "Your chat's pool — a TON smart contract")}
        className="ring-2 ring-[color:var(--accent)]"
      >
        <p>
          {L(
            "Проверяет подпись и лимиты и только тогда платит. Вывести остаток может только ваш админ-кошелёк.",
            "Checks the signature and the limits before paying anything out. Only your admin wallet can withdraw the rest.",
          )}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="tint-accent rounded-full px-2.5 py-1 text-xs font-medium text-accent">
            {L(`лимит ${DAILY_LIMIT_PERCENT}% в сутки`, `${DAILY_LIMIT_PERCENT}% daily limit`)}
          </span>
          <span className="tint-accent rounded-full px-2.5 py-1 text-xs font-medium text-accent">
            {L("пауза одной кнопкой", "one-tap pause")}
          </span>
          <span className="tint-accent rounded-full px-2.5 py-1 text-xs font-medium text-accent">
            {L("одноразовые чеки", "single-use vouchers")}
          </span>
        </div>
      </Node>
      <Flow>{L("участник жмёт «Забрать» — жетоны уходят ему", "the member taps “Claim” and gets the jettons")}</Flow>
      <Node
        icon={<IconTile tone="tint-success text-success"><Check className="h-5 w-5" /></IconTile>}
        title={L("Кошелёк участника", "Member's wallet")}
      >
        {L(
          "Жетоны принадлежат ему: можно копить, обменять на ваши бонусы или перевести другому",
          "The jettons are theirs: keep them, trade them for your perks or send them to someone else",
        )}
      </Node>
      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-dashed border-[color:var(--separator)] p-4 text-[14px] leading-snug">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-hint" />
        <p className="text-hint">
          <b className="text-fg">{L("Куда идут TON.", "Where the TON goes.")}</b>{" "}
          {L(
            "Только на газ сети и хранение контрактов: Achivator не берёт комиссию ни в TON, ни в жетонах. Что транзакция не израсходовала, контракты возвращают отправителю.",
            "Only to network gas and contract storage: Achivator takes no fee, in TON or in jettons. Whatever a transaction does not spend, the contracts send back.",
          )}
        </p>
      </div>
    </div>
  );
}

// ---- Pricing ----

function PriceRow({ what, who, children }) {
  return (
    <div className="grid gap-1 border-t border-[color:var(--separator)] py-3 first:border-t-0 first:pt-0 last:pb-0 md:grid-cols-[1.2fr_1fr_1.4fr] md:gap-4">
      <p className="font-semibold">{what}</p>
      <div className="text-[15px] font-medium tabular">{children}</div>
      <p className="text-[14px] leading-snug text-hint">{who}</p>
    </div>
  );
}

// ---- Guarantees ----

function Guarantee({ icon, title, children }) {
  return (
    <li className="flex gap-3">
      {icon}
      <div>
        <p className="font-semibold leading-snug">{title}</p>
        <p className="mt-0.5 text-[14px] leading-relaxed text-hint">{children}</p>
      </div>
    </li>
  );
}

function Faq({ q, children }) {
  return (
    <details className="group border-t border-[color:var(--separator)] first:border-t-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-[16px] font-semibold [&::-webkit-details-marker]:hidden">
        {q}
        <span className="text-xl leading-none text-hint transition group-open:rotate-45">+</span>
      </summary>
      <div className="space-y-2 pb-4 text-[15px] leading-relaxed text-hint">{children}</div>
    </details>
  );
}

export function Landing({ locale }) {
  const en = locale === "en";
  const L = (ruText, enText) => (en ? enText : ruText);
  const numbers = new Intl.NumberFormat(en ? "en-US" : "ru-RU", { maximumFractionDigits: 4 });
  const fmt = (n) => numbers.format(Number(n));
  const ton = (nanotons) => fmt(Number(nanotons) / 1e9);
  const help = `/${locale}/help`;

  const cfg = getTonConfig();
  const rate = Number(cfg.jettonsPerPoint);
  const testnet = cfg.network !== "mainnet";
  const depositGas = ton(BigInt(GAS.depositTransferGas) + BigInt(GAS.depositForward));
  const setupTon = ton(BigInt(GAS.createPoolTon) + BigInt(GAS.setAdminTon));

  const check = <Check className="mt-0.5 h-5 w-5 shrink-0 text-success" />;
  const trust = <Info className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--gold-text)]" />;

  return (
    <div className="pb-safe overflow-x-clip">
      <header
        className="sticky top-0 z-20 backdrop-blur-md"
        style={{ background: "color-mix(in srgb, var(--bg) 85%, transparent)" }}
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 md:px-6">
          <Link href={`/${locale}`} className="flex items-center gap-2" aria-label="Achivator">
            <span className="hero-gradient flex h-8 w-8 items-center justify-center rounded-[10px]">
              <Medal className="h-[18px] w-[18px]" />
            </span>
            <span className="text-[17px] font-bold tracking-tight">Achivator</span>
          </Link>
          <nav className="flex items-center gap-3 text-[14px] font-medium sm:gap-4">
            <a href="#how" className="hidden text-hint hover:text-fg md:inline">
              {L("Как работает", "How it works")}
            </a>
            <a href="#pricing" className="hidden text-hint hover:text-fg md:inline">
              {L("Стоимость", "Pricing")}
            </a>
            <a href="#guarantees" className="hidden text-hint hover:text-fg md:inline">
              {L("Гарантии", "Guarantees")}
            </a>
            <LangSwitch locale={locale} />
            <a href={APP_URL} className="rounded-full bg-accent px-3.5 py-1.5 font-semibold text-accent-fg active:opacity-80">
              {L("Открыть", "Open")}
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 md:px-6">
        {/* Hero */}
        <section className="grid items-center gap-10 pb-6 pt-8 md:grid-cols-[1.15fr_1fr] md:gap-12 md:pb-10 md:pt-16">
          <div className="space-y-5">
            <Eyebrow>{L("Система лояльности для Telegram-чатов", "A loyalty system for Telegram chats")}</Eyebrow>
            <h1 className="text-[34px] font-bold leading-[1.1] tracking-tight text-balance md:text-[48px]">
              {L("Благодарите участников не только лайком", "Thank your members with more than a like")}
            </h1>
            <p className="text-[17px] leading-relaxed text-hint md:text-[18px]">
              {L(
                "Achivator превращает реакции на полезные сообщения в баллы, а баллы — в жетоны вашего сообщества. Участник забирает их в свой кошелёк сам. Бюджет, правила выплат и защита от накруток — у вас.",
                "Achivator turns reactions to helpful messages into points, and points into your community's own jetton. Members claim them to their wallets themselves. The budget, the payout rules and the anti-cheating controls stay with you.",
              )}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <PrimaryCta href={help}>{L("Подключить свой чат", "Connect your chat")}</PrimaryCta>
              <SecondaryCta href="#how">{L("Как это работает", "How it works")}</SecondaryCta>
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[14px] text-hint">
              <li className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-success" />{" "}
                {L("Жетоны лежат в контракте чата, не у нас", "Jettons sit in the chat's contract, not with us")}
              </li>
              <li className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-success" /> {L("Открытый код", "Open source")}
              </li>
              <li className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-success" /> {L("Ачивки — бесплатно", "Achievements are free")}
              </li>
            </ul>
          </div>
          <ChatMock L={L} fmt={fmt} rate={rate} />
        </section>

        {testnet && (
          <div className="tint-gold flex items-start gap-3 rounded-card px-4 py-3 text-[14px] leading-snug text-[color:var(--gold-text)]">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0" />
            <p>
              <b>{L("Сейчас Achivator работает в тестовой сети TON.", "Achivator currently runs on the TON testnet.")}</b>{" "}
              {L(
                "Всё можно попробовать на бесплатных тестовых монетах: выпустить жетон, наполнить пул и выплатить награды — без настоящих денег.",
                "You can try everything with free test coins: issue a jetton, fund the pool and pay out rewards — no real money involved.",
              )}
            </p>
          </div>
        )}

        {/* Why */}
        <Section
          id="why"
          eyebrow={L("Зачем это владельцу чата", "Why chat owners use it")}
          title={L(
            "Чат живёт, пока в нём отвечают. Achivator делает так, чтобы отвечать было выгодно",
            "A chat lives as long as people answer. Achivator makes answering worth it",
          )}
          lead={L(
            "Реакция в Telegram ничего не стоит тому, кто её ставит, и ничего не даёт тому, кто её получил. Achivator даёт ей вес: реакции от реальных участников становятся счётом, который можно забрать.",
            "A Telegram reaction costs the sender nothing and gives the receiver nothing. Achivator gives it weight: reactions from real members add up to a balance people can actually claim.",
          )}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Benefit icon={<Sparkles className="h-5 w-5" />} title={L("Больше полезных ответов", "More helpful answers")}>
              {L(
                "Люди охотнее помогают новичкам, делятся кодом и находками, когда это замечают и засчитывают. Баллы капают за то, что ценит само сообщество, — а не за количество сообщений.",
                "People are keener to help newcomers and share code and finds when it gets noticed and counted. Points go to what the community itself values — not to message count.",
              )}
            </Benefit>
            <Benefit icon={<Gift className="h-5 w-5" />} title={L("Своя валюта сообщества", "Your community's currency")}>
              {L(
                "Жетон — ваш. Вы решаете, что он даёт: вход в закрытый канал, скидку, мерч, созвон с автором, голос при выборе темы эфира. Или просто статус — у кого сколько.",
                "The jetton is yours. You decide what it buys: access to a private channel, a discount, merch, a call with the author, a vote on the next stream topic. Or just status — who has how many.",
              )}
            </Benefit>
            <Benefit icon={<Coins className="h-5 w-5" />} title={L("Бюджет под контролем", "A budget you control")}>
              {L(
                "Платите ровно столько, сколько положили в пул, и сами решаете, сколько жетонов стоит балл. Пополнять можно когда угодно, остаток — вывести обратно. Дневной лимит выплат не даст пулу опустеть за один день.",
                "You pay out exactly what you put in the pool, and you decide how many jettons a point is worth. Top it up any time, withdraw what is left. A daily payout limit keeps the pool from draining in a single day.",
              )}
            </Benefit>
            <Benefit icon={<Medal className="h-5 w-5" />} title={L("Награды вручную", "Manual rewards")}>
              {L("Не всё измеряется реакциями. Отметьте разбор, статью или помощь командой", "Not everything shows up in reactions. Reward a code review, an article or a favour with")}{" "}
              <Cmd>{L("/reward 50 за разбор", "/reward 50 for the review")}</Cmd>{" "}
              {L("— это могут вы, админы и даже другие боты чата.", "— you, your admins and even other bots in the chat can.")}
            </Benefit>
            <Benefit icon={<Shield className="h-5 w-5" />} title={L("Накрутка не окупается", "Cheating doesn't pay")}>
              {L(
                "Реакции от новых аккаунтов не считаются, у каждого человека есть дневные потолки, баллы дозревают несколько дней. Ферма ботов потратит больше, чем заработает.",
                "Reactions from fresh accounts don't count, everyone has daily caps, and points take a few days to mature. A bot farm spends more than it earns.",
              )}
            </Benefit>
            <Benefit icon={<Search className="h-5 w-5" />} title={L("Всё прозрачно", "Fully transparent")}>
              {L(
                "В мини-приложении видно, кто сколько заработал, от кого пришли баллы и что уже выплачено. Спорный случай разбирается за минуту.",
                "The mini app shows who earned what, whose reactions the points came from and what was paid out. A dispute takes a minute to settle.",
              )}
            </Benefit>
          </div>
        </Section>

        {/* How it works */}
        <Section
          id="how"
          eyebrow={L("Как это работает", "How it works")}
          title={L("Три участника: вы, чат и контракт", "Three parties: you, the chat and the contract")}
          lead={L(
            "Баллы считает бот, деньги хранит смарт-контракт вашего чата, а забирает их участник — своей кнопкой, в свой кошелёк.",
            "The bot counts points, your chat's smart contract holds the funds, and members claim them — with their own tap, to their own wallet.",
          )}
        >
          <Scheme L={L} />

          <ol className="mx-auto grid max-w-4xl gap-3 pt-4 md:grid-cols-2">
            {[
              [
                L("Баллы за реакции", "Points for reactions"),
                <>
                  {L(
                    "Позитивная реакция (👍 ❤ 🔥 🎉 👏 🙏 🏆 и ещё полтора десятка) на сообщение участника — 1 балл. На ваши сообщения —",
                    "A positive reaction (👍 ❤ 🔥 🎉 👏 🙏 🏆 and about fifteen more) to a member's message is 1 point. On your own messages it's",
                  )}{" "}
                  ×{CREATOR_MULTIPLIER}.{" "}
                  {L(
                    "Своя реакция на своё сообщение не считается, снятая — забирает балл назад.",
                    "Reacting to yourself doesn't count; removing a reaction takes the point back.",
                  )}
                </>,
              ],
              [
                L("Баллы вручную", "Manual points"),
                <>
                  {L("Ответьте на сообщение", "Reply to a message with")} <Cmd>{L("/reward 50 за помощь", "/reward 50 for helping")}</Cmd>{" "}
                  {L("или напишите", "or send")} <Cmd>/reward @username 50</Cmd>.{" "}
                  {L("Каждая выдача записывается с причиной и автором.", "Every grant is logged with its reason and author.")}
                </>,
              ],
              [
                L("Дозревание", "Maturation"),
                L(
                  `Новые баллы становятся доступны через ${MATURATION_DAYS} дня (настраивается от 0 до 30). Это время, чтобы заметить подозрительную активность до выплаты. Можно открыть выплаты только в определённые дни недели.`,
                  `New points become claimable after ${MATURATION_DAYS} days (configurable, 0 to 30) — time to spot anything suspicious before it is paid. You can also open claims on chosen weekdays only.`,
                ),
              ],
              [
                L("Выплата", "Payout"),
                L(
                  `Участник жмёт «Забрать» в мини-приложении. Сервер выписывает одноразовый подписанный чек, контракт пула проверяет подпись и лимит и отправляет жетоны прямо в кошелёк участника. Курс по умолчанию: 1 балл = ${fmt(rate)} жетона — владелец чата может задать свой.`,
                  `The member taps “Claim” in the mini app. The server issues a single-use signed voucher; the pool contract checks the signature and the limit and sends the jettons straight to the member's wallet. Default rate: 1 point = ${fmt(rate)} jetton — the chat owner can set their own.`,
                ),
              ],
            ].map(([title, body], i) => (
              <li key={i} className="flex gap-3">
                <span className="hero-gradient flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[15px] font-bold tabular">
                  {i + 1}
                </span>
                <div>
                  <p className="font-bold">{title}</p>
                  <p className="mt-1 text-[15px] leading-relaxed text-hint">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        {/* Example */}
        <Section
          id="example"
          eyebrow={L("Пример", "Example")}
          title={L("Клуб фронтендеров на 800 человек", "A frontend club with 800 members")}
          lead={L(
            "Условный чат и условные цифры — чтобы было понятно, как всё складывается.",
            "A made-up chat with made-up numbers, to show how it all adds up.",
          )}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Panel className="space-y-3">
              <p className="text-[13px] font-semibold uppercase tracking-wide text-hint">{L("Владелец", "The owner")}</p>
              <ul className="space-y-2.5 text-[15px] leading-relaxed">
                <li>
                  {L("Выпускает жетон", "Issues a jetton,")} <b>FRONT</b>{" "}
                  {L("— 1 000 000 штук, все приходят на его кошелёк.", "1,000,000 of them, all landing in their wallet.")}
                </li>
                <li>
                  {L("Кладёт в пул", "Puts")} <b>{fmt(20000)} FRONT</b>{" "}
                  {L(
                    `в пул. Это ${fmt(20000 / rate)} баллов — на годы вперёд.`,
                    `into the pool. That covers ${fmt(20000 / rate)} points — years' worth.`,
                  )}
                </li>
                <li>
                  {L("Решает, что даёт жетон:", "Decides what the jetton buys:")} <b>5 FRONT</b>{" "}
                  {L("— месяц в канале с записями эфиров,", "— a month in the channel with stream recordings,")} <b>30 FRONT</b>{" "}
                  {L(
                    "— разбор резюме. Участник переводит жетоны на кошелёк владельца — и получает бонус.",
                    "— a CV review. A member sends the jettons to the owner's wallet and gets the perk.",
                  )}
                </li>
                <li>
                  {L(
                    `Отправляет разово ${setupTon} TON на запуск пула, из них ${ton(GAS.poolReserveTon)} TON остаются на контракте пула, остальное за вычетом газа возвращается. Пополнение стоит только газ сети. Комиссии и процента с жетонов нет.`,
                    `Sends ${setupTon} TON once to set up the pool: ${ton(GAS.poolReserveTon)} TON stays on the pool contract, the rest comes back minus gas. The top-up costs only network gas. No fee, no cut of the jettons.`,
                  )}
                </li>
              </ul>
            </Panel>
            <Panel className="space-y-3">
              <p className="text-[13px] font-semibold uppercase tracking-wide text-hint">
                {L("Участница Аня", "Anna, a member")}
              </p>
              <ul className="space-y-2.5 text-[15px] leading-relaxed">
                <li>
                  {L(
                    "Отвечает новичку и скидывает рабочий конфиг — 14 человек ставят 👍 и 🔥:",
                    "Answers a newcomer with a working config — 14 people react 👍 and 🔥:",
                  )}{" "}
                  <b>{L("+14 баллов", "+14 points")}</b>.
                </li>
                <li>
                  {L("Владелец отмечает её разбор:", "The owner rewards her code review:")}{" "}
                  <Cmd>{L("/reward 50 за разбор PR", "/reward 50 for the PR review")}</Cmd> — <b>{L("+50 баллов", "+50 points")}</b>.
                </li>
                <li>
                  {L("За месяц набирается", "Over a month she collects")} <b>{L(`${fmt(900)} баллов`, `${fmt(900)} points`)}</b>.{" "}
                  {L(
                    `Через ${MATURATION_DAYS} дня дозревания она жмёт «Забрать» — и`,
                    `After ${MATURATION_DAYS} days of maturation she taps “Claim” and`,
                  )}{" "}
                  <b>{fmt(900 * rate)} FRONT</b> {L("у неё в кошельке.", "are in her wallet.")}
                </li>
                <li>
                  {L(
                    "Месяц в канале с записями она «оплатила» тем, что помогала другим.",
                    "She “paid” for a month of recordings by helping others.",
                  )}
                </li>
              </ul>
            </Panel>
          </div>
        </Section>

        {/* Quick start */}
        <Section
          id="start"
          eyebrow={L("Как подключить", "Getting started")}
          title={L("Четыре шага и 15–20 минут", "Four steps, 15–20 minutes")}
          lead={L(
            "Подключить чат может только его создатель. Нужен TON-кошелёк — например, Tonkeeper.",
            "Only the group's creator can connect it. You need a TON wallet, such as Tonkeeper.",
          )}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Panel className="space-y-2">
              <p className="text-[13px] font-semibold text-accent">{L("Шаг 1 · Кошелёк", "Step 1 · Wallet")}</p>
              <p className="font-bold">{L("Заведите TON-кошелёк", "Get a TON wallet")}</p>
              <p className="text-[15px] leading-relaxed text-hint">
                {L("Установите", "Install")} <Ext href="https://tonkeeper.com">Tonkeeper</Ext>{" "}
                {L(
                  "и пополните его на пару TON — на выпуск жетона, активацию пула и газ.",
                  "and put a couple of TON on it — for issuing the jetton, activating the pool and gas.",
                )}
                {testnet &&
                  L(
                    " Для тестовой сети TON бесплатно раздают боты — в инструкции есть ссылки.",
                    " On the testnet, bots hand out TON for free — the guide has the links.",
                  )}
              </p>
            </Panel>
            <Panel className="space-y-2">
              <p className="text-[13px] font-semibold text-accent">{L("Шаг 2 · Жетон", "Step 2 · Jetton")}</p>
              <p className="font-bold">{L("Выпустите жетон сообщества", "Issue a community jetton")}</p>
              <p className="text-[15px] leading-relaxed text-hint">
                {L("В", "In")}{" "}
                <Ext href={testnet ? "https://minter.ton.org/?testnet=true" : "https://minter.ton.org"}>TON Minter</Ext>{" "}
                {L(
                  "укажите название, тикер (например, FRONT) и количество, нажмите Deploy. Подойдёт и уже существующий жетон.",
                  "enter a name, a ticker (say, FRONT) and the supply, then tap Deploy. An existing jetton works too.",
                )}
              </p>
            </Panel>
            <Panel className="space-y-2">
              <p className="text-[13px] font-semibold text-accent">{L("Шаг 3 · Бот", "Step 3 · Bot")}</p>
              <p className="font-bold">{L("Добавьте бота в группу админом", "Add the bot as a group admin")}</p>
              <p className="text-[15px] leading-relaxed text-hint">
                <Ext href={ADD_TO_GROUP_URL}>{L("Добавьте @achivator_bot", "Add @achivator_bot")}</Ext>
                {L(", сделайте его администратором и отправьте в группе", ", make it an admin and send in the group")}{" "}
                <Cmd>/verify@achivator_bot</Cmd> {L("и", "and")} <Cmd>{L("/jetton адрес_жетона", "/jetton jetton_address")}</Cmd>.
              </p>
            </Panel>
            <Panel className="space-y-2">
              <p className="text-[13px] font-semibold text-accent">{L("Шаг 4 · Пул", "Step 4 · Pool")}</p>
              <p className="font-bold">{L("Активируйте и пополните пул", "Activate and fund the pool")}</p>
              <p className="text-[15px] leading-relaxed text-hint">
                {L("В", "In the")} <Ext href={APP_URL}>{L("мини-приложении", "mini app")}</Ext>{" "}
                {L(
                  "→ «Мои чаты» → ваш чат: «Активировать пул», затем «Сделать этот кошелёк админом» и «Пополнение» — введите, сколько жетонов перевести. Подтверждаете каждое действие в кошельке.",
                  "→ “My chats” → your chat: “Activate pool”, then “Make this wallet the admin” and “Top up” with the amount of jettons. You confirm each step in your wallet.",
                )}
              </p>
            </Panel>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <PrimaryCta href={help}>{L("Пошаговая инструкция", "Step-by-step guide")}</PrimaryCta>
            <SecondaryCta href={ADD_TO_GROUP_URL}>{L("Добавить бота в группу", "Add the bot to a group")}</SecondaryCta>
          </div>
        </Section>

        {/* Pricing */}
        <Section
          id="pricing"
          eyebrow={L("Стоимость", "Pricing")}
          title={L("Кто и за что платит", "Who pays for what")}
          lead={L(
            "Сейчас Achivator ничего не берёт: ни комиссии в TON, ни процента с жетонов. Вы платите только газ сети TON и хранение своих контрактов — это уходит валидаторам, а не нам.",
            "Right now Achivator charges nothing: no TON fee, no cut of the jettons. You pay only TON network gas and your contracts' storage — that goes to validators, not to us.",
          )}
        >
          <Panel>
            <PriceRow
              what={L("Ачивки и баллы", "Achievements and points")}
              who={L(
                "Бот, медали и учёт баллов работают сразу после добавления бота.",
                "The bot, medals and point tracking work as soon as the bot joins.",
              )}
            >
              {L("Бесплатно", "Free")}
            </PriceRow>
            <PriceRow
              what={L("Активация пула", "Pool activation")}
              who={L(
                `Разово. ${ton(GAS.poolReserveTon)} TON остаётся на счету контракта пула как резерв на хранение, остальное за вычетом газа возвращается.`,
                `One-off. ${ton(GAS.poolReserveTon)} TON stays on the pool contract as its storage reserve; the rest comes back minus gas.`,
              )}
            >
              {ton(GAS.createPoolTon)} TON
            </PriceRow>
            <PriceRow
              what={L("Назначение админ-кошелька", "Setting the admin wallet")}
              who={L("Разово, газ сети. Неизрасходованное возвращается.", "One-off, network gas. What isn't used comes back.")}
            >
              {ton(GAS.setAdminTon)} TON
            </PriceRow>
            <PriceRow
              what={L("Пополнение пула", "Pool top-up")}
              who={L(
                "Только газ на перевод, комиссии нет. Неизрасходованное возвращается, с суммы жетонов не берётся ничего.",
                "Only gas for the transfer, no fee. What isn't used comes back, and nothing is taken from the jettons.",
              )}
            >
              {L("до", "up to")} {depositGas} TON
            </PriceRow>
            <PriceRow
              what={L("Пауза, лимит, вывод остатка", "Pause, limit, withdrawal")}
              who={L(
                "Газ сети. За паузу и лимит неизрасходованный TON возвращается.",
                "Network gas. For pause and limit changes the unused TON comes back.",
              )}
            >
              {ton(GAS.adminControlTon)}–{ton(GAS.withdrawTon)} TON
            </PriceRow>
            <PriceRow
              what={L("Выплата участнику", "Member payout")}
              who={L(
                "Газ платит сам участник, при нажатии «Забрать». Неизрасходованное возвращается ему вместе с жетонами.",
                "The member pays the gas when tapping “Claim”. What isn't used comes back with the jettons.",
              )}
            >
              {L("до", "up to")} {ton(GAS.claimTon)} TON
            </PriceRow>
          </Panel>
          <p className="text-[14px] leading-relaxed text-hint">
            {L(
              "Точную сумму каждой транзакции вы видите в кошельке до подтверждения. У мастер-контракта и реестра ачивок нет команды вывода TON — даже у владельца.",
              "Your wallet shows the exact amount of every transaction before you confirm it. The master contract and the achievement registry have no command to pay TON out — not even for their owner.",
            )}
          </p>
        </Section>

        {/* Guarantees */}
        <Section
          id="guarantees"
          eyebrow={L("Гарантии", "Guarantees")}
          title={L("Что зашито в контракт, а что держится на доверии", "What the contract enforces, and what rests on trust")}
          lead={L(
            "Мы не просим верить на слово. Вот честное разделение: что обеспечивает блокчейн, а где вы полагаетесь на наш сервис.",
            "We don't ask you to take our word for it. Here is the honest split: what the blockchain guarantees and where you rely on our service.",
          )}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Panel className="space-y-4">
              <div className="flex items-center gap-2">
                <Lock className="h-5 w-5 text-success" />
                <p className="font-bold">{L("Обеспечивает смарт-контракт", "Enforced by the smart contract")}</p>
              </div>
              <ul className="space-y-4">
                <Guarantee icon={check} title={L("Жетоны лежат в контракте вашего чата", "Jettons sit in your chat's contract")}>
                  {L(
                    "Не на кошельке Achivator. У каждого чата свой пул, адрес виден в мини-приложении и в любом обозревателе TON.",
                    "Not in an Achivator wallet. Every chat has its own pool; the address is shown in the mini app and in any TON explorer.",
                  )}
                </Guarantee>
                <Guarantee icon={check} title={L("Вывести остаток можете только вы", "Only you can withdraw")}>
                  {L(
                    "Вывод, пауза и лимит принимаются только от админ-кошелька пула. У Achivator такой команды нет ни в контракте пула, ни в мастер-контракте.",
                    "Withdrawal, pause and limit are accepted only from the pool's admin wallet. Achivator has no such command, neither in the pool contract nor in the master contract.",
                  )}
                </Guarantee>
                <Guarantee icon={check} title={L("Админа не подменить", "The admin can't be swapped")}>
                  {L(
                    "Передать права на пул может только текущий админ. Пока админ не назначен, пул возвращает любые пополнения отправителю.",
                    "Only the current admin can hand the pool over. Until an admin is set, the pool sends every deposit back.",
                  )}
                </Guarantee>
                <Guarantee icon={check} title={L("Лимит на выплаты в сутки", "A daily payout limit")}>
                  {L(
                    `По умолчанию не больше ${DAILY_LIMIT_PERCENT}% пула в день, можно задать своё число. Даже в худшем случае пул не опустеет за один день.`,
                    `By default at most ${DAILY_LIMIT_PERCENT}% of the pool a day, or a number you set. Even in the worst case the pool won't empty in a day.`,
                  )}
                </Guarantee>
                <Guarantee icon={check} title={L("Никакой комиссии в TON", "No TON fee")}>
                  {L(
                    "Контракты берут только газ и плату за хранение того, что вы в них записали, а остальное возвращают. Вывести TON из мастер-контракта или реестра ачивок не может никто.",
                    "The contracts take only gas and the storage of what you write to them, and send the rest back. No one can take TON out of the master contract or the achievement registry.",
                  )}
                </Guarantee>
                <Guarantee icon={check} title={L("Одноразовые чеки", "Single-use vouchers")}>
                  {L(
                    "Каждый чек на выплату подписан для конкретного пула, действует час и принимается один раз.",
                    "Every payout voucher is signed for one specific pool, is valid for an hour and is accepted once.",
                  )}
                </Guarantee>
              </ul>
            </Panel>
            <Panel className="space-y-4">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-[color:var(--gold-text)]" />
                <p className="font-bold">{L("Держится на доверии к сервису", "Relies on trusting the service")}</p>
              </div>
              <ul className="space-y-4">
                <Guarantee icon={trust} title={L("Баллы считает наш сервер", "Our server counts the points")}>
                  {L(
                    "Бот записывает реакции и выдачи в базу Achivator. Сами баллы — не в блокчейне, пока участник их не забрал.",
                    "The bot records reactions and grants in Achivator's database. Points are not on-chain until a member claims them.",
                  )}
                </Guarantee>
                <Guarantee icon={trust} title={L("Чеки подписывает ключ сервера", "The server's key signs vouchers")}>
                  {L(
                    "Поэтому контракт и ограничивает выплаты дневным лимитом. Если что-то пойдёт не так — поставьте выплаты на паузу и замените ключ: подписи старого ключа перестанут работать сразу.",
                    "That's exactly why the contract caps payouts per day. If something goes wrong, pause payouts and replace the key: the old key's signatures stop working at once.",
                  )}
                </Guarantee>
                <Guarantee icon={trust} title={L("Если Achivator закроется", "If Achivator shuts down")}>
                  {L(
                    "Участники не смогут забрать ещё не выплаченные баллы. Но жетоны из пула вы выведете сами, напрямую через контракт, — наш сервер для этого не нужен.",
                    "Members won't be able to claim points not yet paid out. But you withdraw the pool's jettons yourself, straight through the contract — our server isn't needed for that.",
                  )}
                </Guarantee>
              </ul>
            </Panel>
          </div>
          <p className="text-[15px] leading-relaxed text-hint">
            {L(
              "Весь код — контракты, бот и мини-приложение — открыт:",
              "All the code — contracts, bot and mini app — is open source:",
            )}{" "}
            <Ext href={GITHUB_URL}>github.com/achivator</Ext>.{" "}
            {L("Проверьте сами или попросите знакомого разработчика.", "Check it yourself or ask a developer you trust.")}
          </p>
        </Section>

        {/* Anti-farming */}
        <Section
          id="antifraud"
          eyebrow={L("Защита от накруток", "Anti-cheating")}
          title={L("Почему баллы не накрутить твинками", "Why alt accounts can't farm points")}
          lead={L(
            "Реакции дёшево подделать, поэтому бот платит только за реакции, похожие на настоящие.",
            "Reactions are cheap to fake, so the bot pays only for reactions that look real.",
          )}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [
                <Users key="i" className="h-5 w-5" />,
                L(`${MIN_REACTOR_MESSAGES}+ сообщений`, `${MIN_REACTOR_MESSAGES}+ messages`),
                L(
                  "Реакции от тех, кто написал в чате меньше пяти сообщений, баллов не приносят.",
                  "Reactions from people with fewer than five messages in the chat earn nothing.",
                ),
              ],
              [
                <Shield key="i" className="h-5 w-5" />,
                L(`${PAIR_DAILY_CAP} в день от одного`, `${PAIR_DAILY_CAP} a day per person`),
                L(
                  "Один человек может принести другому не больше пяти оплаченных реакций в сутки.",
                  "One person can give another at most five paid reactions a day.",
                ),
              ],
              [
                <Coins key="i" className="h-5 w-5" />,
                L(`${RECEIVER_DAILY_CAP} баллов в день`, `${RECEIVER_DAILY_CAP} points a day`),
                L("Потолок заработка на реакциях для одного участника в сутки.", "The most a member can earn from reactions in a day."),
              ],
              [
                <Clock key="i" className="h-5 w-5" />,
                L(`${MATURATION_DAYS} дня дозревания`, `${MATURATION_DAYS} days to mature`),
                L(
                  "До выплаты есть время заметить подозрительное и поставить выплаты на паузу.",
                  "Time to spot anything odd and pause payouts before they happen.",
                ),
              ],
            ].map(([icon, title, body], i) => (
              <Panel key={i} className="space-y-2">
                <IconTile>{icon}</IconTile>
                <p className="font-bold">{title}</p>
                <p className="text-[14px] leading-relaxed text-hint">{body}</p>
              </Panel>
            ))}
          </div>
          <p className="text-[14px] text-hint">
            {L(
              "Значения по умолчанию. В карточке участника видно, от кого пришли его баллы, — «кольцо» из пары аккаунтов заметно сразу.",
              "These are the defaults. A member's card shows whose reactions their points came from, so a ring of a couple of accounts stands out right away.",
            )}
          </p>
        </Section>

        {/* Achievements */}
        <Section
          id="achievements"
          eyebrow={L("Бонус", "Bonus")}
          title={L("Ачивки за стиль общения — с первой минуты", "Achievements for how people chat — from minute one")}
          lead={L(
            "Ещё до жетонов бот раздаёт медали: за первый код в чате, голосовое, сообщение ровно в полночь, первую сотню сообщений. Их видно в мини-приложении, а в будущем — можно будет выпустить как NFT.",
            "Even before any jettons, the bot hands out medals: for the first code snippet, a voice message, a message sent exactly at midnight, the first hundred messages. They show up in the mini app, and later can be minted as NFTs.",
          )}
        >
          <ul className="grid grid-cols-4 gap-3 sm:grid-cols-8">
            {MEDALS.map((m) => (
              <li key={m} className="space-y-1.5 text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/achievements/v1/${encodeURIComponent(m)}.webp`}
                  alt={m}
                  loading="lazy"
                  className="aspect-square w-full rounded-2xl bg-white object-cover ring-1 ring-black/5"
                />
                <span className="block text-[11px] font-medium capitalize leading-tight text-hint">{m}</span>
              </li>
            ))}
          </ul>
        </Section>

        {/* FAQ */}
        <Section id="faq" eyebrow={L("Вопросы", "FAQ")} title={L("Частые вопросы", "Frequently asked questions")}>
          <Panel className="py-1">
            <Faq q={L("Это криптоинвестиция? Жетон вырастет в цене?", "Is this a crypto investment? Will the jetton go up?")}>
              <p>
                {L(
                  "Нет. Жетон здесь — баллы лояльности вашего сообщества, как мили у авиакомпании. Его ценность — то, что вы за него даёте. Achivator не торгует жетонами, не выводит их на биржи и ничего не обещает про курс.",
                  "No. Here the jetton is your community's loyalty points, like airline miles. Its value is whatever you offer for it. Achivator doesn't trade jettons, doesn't list them on exchanges and promises nothing about price.",
                )}
              </p>
            </Faq>
            <Faq q={L("Зачем тогда блокчейн, почему не обычные баллы?", "Then why a blockchain and not plain points?")}>
              <p>
                {L(
                  "Чтобы награда не зависела от доброй воли сервиса. Правила выплат исполняет контракт, а выплаченные жетоны принадлежат участнику: их не аннулировать задним числом, они не пропадут вместе с сервисом и видны в любом TON-кошельке.",
                  "So a reward doesn't depend on the service's goodwill. The contract enforces the payout rules, and paid-out jettons belong to the member: they can't be revoked after the fact, don't vanish with the service and show up in any TON wallet.",
                )}
              </p>
            </Faq>
            <Faq q={L("Нужно ли разбираться в крипте?", "Do I need to understand crypto?")}>
              <p>
                {L(
                  "Владельцу — на уровне «установить кошелёк и подтвердить транзакцию»: пошаговая",
                  "As an owner, only enough to install a wallet and confirm a transaction: the step-by-step",
                )}{" "}
                <Link href={help} className="font-medium text-link">
                  {L("инструкция", "guide")}
                </Link>{" "}
                {L(
                  "занимает 15–20 минут. Участникам нужен TON-кошелёк и немного TON на газ, чтобы забрать награду.",
                  "takes 15–20 minutes. Members need a TON wallet and a little TON for gas to claim a reward.",
                )}
              </p>
            </Faq>
            <Faq q={L("Бот читает нашу переписку?", "Does the bot read our messages?")}>
              <p>
                {L(
                  "Бот видит сообщения, потому что он админ, но хранит только статистику: кто, когда и какого типа сообщение написал и какие реакции получил. Тексты сообщений не сохраняются.",
                  "The bot sees messages because it's an admin, but it only keeps statistics: who wrote what kind of message when, and which reactions it got. Message texts are not stored.",
                )}
              </p>
            </Faq>
            <Faq q={L("Можно наградить не жетоном, который я выпустил, а уже существующим?", "Can I reward with an existing jetton instead of my own?")}>
              <p>
                {L(
                  "Да, подойдёт любой жетон стандарта TON (TEP-74): укажите адрес его мастер-контракта командой",
                  "Yes, any standard TON jetton (TEP-74) works: set its master contract address with",
                )}{" "}
                <Cmd>/jetton</Cmd>.
              </p>
            </Faq>
            <Faq q={L("Кто может подключить чат и начислять баллы?", "Who can connect the chat and grant points?")}>
              <p>
                {L(
                  "Привязать жетон и управлять пулом может только создатель группы. Начислять баллы командой",
                  "Only the group's creator can set the jetton and manage the pool. Points can be granted with",
                )}{" "}
                <Cmd>/reward</Cmd>{" "}
                {L(
                  "— создатель и любые администраторы, в том числе боты-администраторы.",
                  "by the creator and any admin, admin bots included.",
                )}
              </p>
            </Faq>
            <Faq q={L("Что если я передумаю?", "What if I change my mind?")}>
              <p>
                {L(
                  "Поставьте выплаты на паузу и выведите остаток жетонов из пула на свой кошелёк. Уже выплаченное остаётся у участников.",
                  "Pause payouts and withdraw the remaining jettons to your wallet. Whatever was paid out stays with the members.",
                )}
              </p>
            </Faq>
          </Panel>
        </Section>

        {/* Final CTA */}
        <section className="py-10 md:py-14">
          <div className="hero-gradient relative overflow-hidden rounded-[26px] p-6 md:p-10">
            <div className="pointer-events-none absolute -right-10 -top-12 h-48 w-48 rounded-full bg-white/10" />
            <div className="pointer-events-none absolute -bottom-16 right-16 h-36 w-36 rounded-full bg-white/10" />
            <div className="relative max-w-xl space-y-4">
              <h2 className="text-[26px] font-bold leading-tight tracking-tight md:text-[32px]">
                {L("Попробуйте на своём чате", "Try it in your chat")}
              </h2>
              <p className="text-[16px] leading-relaxed opacity-90">
                {L(
                  `Ачивки заработают сразу после добавления бота. Жетоны — когда будете готовы: 15–20 минут по инструкции${testnet ? ", на бесплатных тестовых монетах" : ""}.`,
                  `Achievements start working as soon as the bot joins. Jettons whenever you're ready: 15–20 minutes with the guide${testnet ? ", on free test coins" : ""}.`,
                )}
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  href={help}
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-6 text-[15px] font-semibold text-[#1d4ed8] active:opacity-85"
                >
                  {L("Подключить свой чат", "Connect your chat")}
                </Link>
                <a
                  href={APP_URL}
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-white/20 px-6 text-[15px] font-semibold active:opacity-85"
                >
                  {L("Открыть в Telegram", "Open in Telegram")}
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 border-t border-[color:var(--separator)] px-4 py-6 text-[14px] text-hint md:px-6">
        <span>{L("Achivator · награды и ачивки для Telegram-чатов", "Achivator · rewards and achievements for Telegram chats")}</span>
        <div className="flex flex-wrap gap-4">
          <Link href={help} className="hover:text-fg">
            {L("Инструкция", "Guide")}
          </Link>
          <a href={CHANNEL_URL} className="hover:text-fg">
            {L("Канал", "Channel")}
          </a>
          <a href="https://t.me/achivator_bot" className="hover:text-fg">
            @achivator_bot
          </a>
          <a href={GITHUB_URL} className="hover:text-fg">
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
