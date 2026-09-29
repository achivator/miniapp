import Link from "next/link";
import { getTonConfig, tierForMembers } from "@/lib/ton/config";
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

// Landing page for visitors from the web (Russian, like the setup guide):
// what Achivator gives a chat owner, how the money flows, what it costs and
// what is guaranteed by the contracts versus by trust in the service. A
// server component: numbers come from the same config the API uses, so the
// page cannot promise a rate or a fee the backend does not apply.

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

const ru = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 4 });
const fmt = (n) => ru.format(Number(n));
const ton = (nanotons) => fmt(Number(nanotons) / 1e9);

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

function PrimaryCta({ href, children, className = "" }) {
  return (
    <Link
      href={href}
      className={`inline-flex h-12 items-center justify-center rounded-xl bg-accent px-6 text-[15px] font-semibold text-accent-fg transition active:scale-[0.98] active:opacity-85 ${className}`}
    >
      {children}
    </Link>
  );
}

function SecondaryCta({ href, children, className = "" }) {
  return (
    <a
      href={href}
      className={`tint-accent inline-flex h-12 items-center justify-center rounded-xl px-6 text-[15px] font-semibold text-accent transition active:scale-[0.98] active:opacity-85 ${className}`}
    >
      {children}
    </a>
  );
}

// ---- Hero: what a member sees, in one glance ----

function ChatMock({ rate }) {
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
            <p className="text-[15px] font-semibold">Клуб фронтендеров</p>
            <p className="text-[12px] text-hint">800 участников</p>
          </div>
        </div>

        <div className="flex items-end gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-400 to-violet-500 text-[13px] font-semibold text-white">
            А
          </span>
          <div className="rounded-2xl rounded-bl-md bg-bg px-3 py-2">
            <p className="text-[13px] font-semibold text-link">Аня</p>
            <p className="text-[14px] leading-snug">
              Держи рабочий конфиг vite + vitest, у меня завелось с первого раза 👇
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
            +14 баллов Ане за полезный ответ
          </span>
        </div>

        <div className="hero-gradient flex items-center gap-3 rounded-2xl p-3">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] opacity-80">Аня · за месяц</p>
            <p className="text-[20px] font-bold leading-tight tabular">
              {fmt(month)} баллов <span className="text-[14px] font-semibold opacity-85">≈ {fmt(month * rate)} FRONT</span>
            </p>
          </div>
          <span className="rounded-xl bg-white/25 px-3 py-2 text-[13px] font-semibold">Claim</span>
        </div>
      </div>
    </div>
  );
}

// ---- The scheme: where jettons, points and fees go ----

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

function Scheme({ feeRange }) {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="grid grid-cols-2 gap-3">
        <Node icon={<IconTile><Coins className="h-5 w-5" /></IconTile>} title="Вы">
          Выпускаете жетон сообщества и решаете, сколько положить в пул
        </Node>
        <Node icon={<IconTile><Users className="h-5 w-5" /></IconTile>} title="Чат и бот">
          Участники ставят 👍 ❤ 🔥, бот превращает их в баллы
        </Node>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Flow>жетоны</Flow>
        <Flow>подписанный чек на выплату</Flow>
      </div>
      <Node
        icon={
          <div className="hero-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
            <Pool className="h-5 w-5" />
          </div>
        }
        title="Пул вашего чата — смарт-контракт в TON"
        className="ring-2 ring-[color:var(--accent)]"
      >
        <p>Проверяет подпись и лимиты и только тогда платит. Вывести остаток может только ваш админ-кошелёк.</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="tint-accent rounded-full px-2.5 py-1 text-xs font-medium text-accent">
            лимит {DAILY_LIMIT_PERCENT}% в сутки
          </span>
          <span className="tint-accent rounded-full px-2.5 py-1 text-xs font-medium text-accent">пауза одной кнопкой</span>
          <span className="tint-accent rounded-full px-2.5 py-1 text-xs font-medium text-accent">одноразовые чеки</span>
        </div>
      </Node>
      <Flow>участник жмёт «Claim» — жетоны уходят ему</Flow>
      <Node icon={<IconTile tone="tint-success text-success"><Check className="h-5 w-5" /></IconTile>} title="Кошелёк участника">
        Жетоны принадлежат ему: можно копить, обменять на ваши бонусы или перевести другому
      </Node>
      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-dashed border-[color:var(--separator)] p-4 text-[14px] leading-snug">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-hint" />
        <p className="text-hint">
          <b className="text-fg">Куда идёт комиссия.</b> С каждого пополнения пула Achivator берёт фиксированную плату в
          TON ({feeRange}) — она уходит на мастер-контракт проекта. Из ваших жетонов не удерживается ни одного.
        </p>
      </div>
    </div>
  );
}

// ---- Pricing ----

function tierLabel(tiers, i) {
  const from = tiers[i].minMembers;
  const next = tiers[i + 1]?.minMembers;
  if (next === undefined) return `от ${fmt(from)} участников`;
  if (from === 0) return `до ${fmt(next - 1)} участников`;
  return `${fmt(from)}–${fmt(next - 1)} участников`;
}

function PriceRow({ what, who, children }) {
  return (
    <div className="grid gap-1 border-t border-[color:var(--separator)] py-3 first:border-t-0 first:pt-0 last:pb-0 md:grid-cols-[1.2fr_1fr_1.4fr] md:gap-4">
      <p className="font-semibold">{what}</p>
      <p className="text-[15px] font-medium tabular">{children}</p>
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

export function Landing() {
  const cfg = getTonConfig();
  const rate = Number(cfg.jettonsPerPoint);
  const tiers = cfg.feeTiers;
  const fees = tiers.map((t) => Number(t.feeTon));
  const feeRange =
    Math.min(...fees) === Math.max(...fees)
      ? `${fmt(fees[0])} TON`
      : `от ${fmt(Math.min(...fees))} до ${fmt(Math.max(...fees))} TON в зависимости от размера чата`;
  const testnet = cfg.network !== "mainnet";
  const depositGas = ton(BigInt(GAS.depositTransferGas) + BigInt(GAS.depositForwardExtra));

  return (
    <div lang="ru" className="pb-safe overflow-x-clip">
      <header
        className="sticky top-0 z-20 backdrop-blur-md"
        style={{ background: "color-mix(in srgb, var(--bg) 85%, transparent)" }}
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 md:px-6">
          <Link href="/" className="flex items-center gap-2" aria-label="Achivator">
            <span className="hero-gradient flex h-8 w-8 items-center justify-center rounded-[10px]">
              <Medal className="h-[18px] w-[18px]" />
            </span>
            <span className="text-[17px] font-bold tracking-tight">Achivator</span>
          </Link>
          <nav className="flex items-center gap-4 text-[14px] font-medium">
            <a href="#how" className="hidden text-hint hover:text-fg sm:inline">Как работает</a>
            <a href="#pricing" className="hidden text-hint hover:text-fg sm:inline">Стоимость</a>
            <a href="#guarantees" className="hidden text-hint hover:text-fg md:inline">Гарантии</a>
            <a href={APP_URL} className="rounded-full bg-accent px-3.5 py-1.5 font-semibold text-accent-fg active:opacity-80">
              Открыть
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 md:px-6">
        {/* Hero */}
        <section className="grid items-center gap-10 pb-6 pt-8 md:grid-cols-[1.15fr_1fr] md:gap-12 md:pb-10 md:pt-16">
          <div className="space-y-5">
            <Eyebrow>Система лояльности для Telegram-чатов</Eyebrow>
            <h1 className="text-[34px] font-bold leading-[1.1] tracking-tight text-balance md:text-[48px]">
              Благодарите участников не только лайком
            </h1>
            <p className="text-[17px] leading-relaxed text-hint md:text-[18px]">
              Achivator превращает реакции на полезные сообщения в баллы, а баллы — в жетоны вашего сообщества. Участник
              забирает их в свой кошелёк сам. Бюджет, правила выплат и защита от накруток — у вас.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <PrimaryCta href="/help">Подключить свой чат</PrimaryCta>
              <SecondaryCta href="#how">Как это работает</SecondaryCta>
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[14px] text-hint">
              <li className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-success" /> Жетоны лежат в контракте чата, не у нас
              </li>
              <li className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-success" /> Открытый код
              </li>
              <li className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-success" /> Ачивки — бесплатно
              </li>
            </ul>
          </div>
          <ChatMock rate={rate} />
        </section>

        {testnet && (
          <div className="tint-gold flex items-start gap-3 rounded-card px-4 py-3 text-[14px] leading-snug text-[color:var(--gold-text)]">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0" />
            <p>
              <b>Сейчас Achivator работает в тестовой сети TON.</b> Всё можно попробовать на бесплатных тестовых монетах:
              выпустить жетон, наполнить пул и выплатить награды — без настоящих денег.
            </p>
          </div>
        )}

        {/* Why */}
        <Section
          id="why"
          eyebrow="Зачем это владельцу чата"
          title="Чат живёт, пока в нём отвечают. Achivator делает так, чтобы отвечать было выгодно"
          lead="Реакция в Telegram ничего не стоит тому, кто её ставит, и ничего не даёт тому, кто её получил. Achivator даёт ей вес: реакции от реальных участников становятся счётом, который можно забрать."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Benefit icon={<Sparkles className="h-5 w-5" />} title="Больше полезных ответов">
              Люди охотнее помогают новичкам, делятся кодом и находками, когда это замечают и засчитывают. Баллы капают за
              то, что ценит само сообщество, — а не за количество сообщений.
            </Benefit>
            <Benefit icon={<Gift className="h-5 w-5" />} title="Своя валюта сообщества">
              Жетон — ваш. Вы решаете, что он даёт: вход в закрытый канал, скидку, мерч, созвон с автором, голос при выборе
              темы эфира. Или просто статус — у кого сколько.
            </Benefit>
            <Benefit icon={<Coins className="h-5 w-5" />} title="Бюджет под контролем">
              Платите ровно столько, сколько положили в пул. Пополнять можно когда угодно, остаток — вывести обратно.
              Дневной лимит выплат не даст пулу опустеть за один день.
            </Benefit>
            <Benefit icon={<Medal className="h-5 w-5" />} title="Награды вручную">
              Не всё измеряется реакциями. Отметьте разбор, статью или помощь командой <Cmd>/reward 50 за разбор</Cmd> —
              это могут вы, админы и даже другие боты чата.
            </Benefit>
            <Benefit icon={<Shield className="h-5 w-5" />} title="Накрутка не окупается">
              Реакции от новых аккаунтов не считаются, у каждого человека есть дневные потолки, баллы дозревают несколько
              дней. Ферма ботов потратит больше, чем заработает.
            </Benefit>
            <Benefit icon={<Search className="h-5 w-5" />} title="Всё прозрачно">
              В мини-приложении видно, кто сколько заработал, от кого пришли баллы и что уже выплачено. Спорный случай
              разбирается за минуту.
            </Benefit>
          </div>
        </Section>

        {/* How it works */}
        <Section
          id="how"
          eyebrow="Как это работает"
          title="Три участника: вы, чат и контракт"
          lead="Баллы считает бот, деньги хранит смарт-контракт вашего чата, а забирает их участник — своей кнопкой, в свой кошелёк."
        >
          <Scheme feeRange={feeRange} />

          <ol className="mx-auto grid max-w-4xl gap-3 pt-4 md:grid-cols-2">
            {[
              [
                "Баллы за реакции",
                <>
                  Позитивная реакция (👍 ❤ 🔥 🎉 👏 🙏 🏆 и ещё полтора десятка) на сообщение участника — 1 балл. На ваши
                  сообщения — ×{CREATOR_MULTIPLIER}. Своя реакция на своё сообщение не считается, снятая — забирает балл
                  назад.
                </>,
              ],
              [
                "Баллы вручную",
                <>
                  Ответьте на сообщение <Cmd>/reward 50 за помощь</Cmd> или напишите <Cmd>/reward @username 50</Cmd>.
                  Каждая выдача записывается с причиной и автором.
                </>,
              ],
              [
                "Дозревание",
                <>
                  Новые баллы становятся доступны через {MATURATION_DAYS} дня (настраивается от 0 до 30). Это время, чтобы
                  заметить подозрительную активность до выплаты. Можно открыть выплаты только в определённые дни недели.
                </>,
              ],
              [
                "Выплата",
                <>
                  Участник жмёт «Claim» в мини-приложении. Сервер выписывает одноразовый подписанный чек, контракт пула
                  проверяет подпись и лимит и отправляет жетоны прямо в кошелёк участника. Курс: 1 балл = {fmt(rate)}{" "}
                  жетона.
                </>,
              ],
            ].map(([title, body], i) => (
              <li key={title} className="flex gap-3">
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
          eyebrow="Пример"
          title="Клуб фронтендеров на 800 человек"
          lead="Условный чат и условные цифры — чтобы было понятно, как всё складывается."
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Panel className="space-y-3">
              <p className="text-[13px] font-semibold uppercase tracking-wide text-hint">Владелец</p>
              <ul className="space-y-2.5 text-[15px] leading-relaxed">
                <li>
                  Выпускает жетон <b>FRONT</b> — 1 000 000 штук, все приходят на его кошелёк.
                </li>
                <li>
                  Кладёт в пул <b>20 000 FRONT</b>. Это {fmt(20000 / rate)} баллов — на годы вперёд.
                </li>
                <li>
                  Решает, что даёт жетон: <b>5 FRONT</b> — месяц в канале с записями эфиров, <b>30 FRONT</b> — разбор
                  резюме. Участник переводит жетоны на кошелёк владельца — и получает бонус.
                </li>
                <li>
                  Платит разово {ton(BigInt(GAS.createPoolTon) + BigInt(GAS.setAdminTon))} TON за запуск пула и{" "}
                  {fmt(tierForMembers(800).feeTon)} TON комиссии Achivator за это пополнение, плюс газ сети. Процента с
                  жетонов нет.
                </li>
              </ul>
            </Panel>
            <Panel className="space-y-3">
              <p className="text-[13px] font-semibold uppercase tracking-wide text-hint">Участница Аня</p>
              <ul className="space-y-2.5 text-[15px] leading-relaxed">
                <li>
                  Отвечает новичку и скидывает рабочий конфиг — 14 человек ставят 👍 и 🔥: <b>+14 баллов</b>.
                </li>
                <li>
                  Владелец отмечает её разбор: <Cmd>/reward 50 за разбор PR</Cmd> — <b>+50 баллов</b>.
                </li>
                <li>
                  За месяц набирается <b>900 баллов</b>. Через {MATURATION_DAYS} дня дозревания она жмёт «Claim» — и{" "}
                  <b>{fmt(900 * rate)} FRONT</b> у неё в кошельке.
                </li>
                <li>Месяц в канале с записями она «оплатила» тем, что помогала другим.</li>
              </ul>
            </Panel>
          </div>
        </Section>

        {/* Quick start */}
        <Section
          id="start"
          eyebrow="Как подключить"
          title="Четыре шага и 15–20 минут"
          lead="Подключить чат может только его создатель. Нужен TON-кошелёк — например, Tonkeeper."
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Panel className="space-y-2">
              <p className="text-[13px] font-semibold text-accent">Шаг 1 · Кошелёк</p>
              <p className="font-bold">Заведите TON-кошелёк</p>
              <p className="text-[15px] leading-relaxed text-hint">
                Установите <Ext href="https://tonkeeper.com">Tonkeeper</Ext> и пополните его на пару TON — на выпуск жетона,
                активацию пула и комиссии.
                {testnet && " Для тестовой сети TON бесплатно раздают боты — в инструкции есть ссылки."}
              </p>
            </Panel>
            <Panel className="space-y-2">
              <p className="text-[13px] font-semibold text-accent">Шаг 2 · Жетон</p>
              <p className="font-bold">Выпустите жетон сообщества</p>
              <p className="text-[15px] leading-relaxed text-hint">
                В <Ext href={testnet ? "https://minter.ton.org/?testnet=true" : "https://minter.ton.org"}>TON Minter</Ext>{" "}
                укажите название, тикер (например, FRONT) и количество, нажмите Deploy. Подойдёт и уже существующий жетон.
              </p>
            </Panel>
            <Panel className="space-y-2">
              <p className="text-[13px] font-semibold text-accent">Шаг 3 · Бот</p>
              <p className="font-bold">Добавьте бота в группу админом</p>
              <p className="text-[15px] leading-relaxed text-hint">
                <Ext href={ADD_TO_GROUP_URL}>Добавьте @achivator_bot</Ext>, сделайте его администратором и отправьте в
                группе <Cmd>/verify@achivator_bot</Cmd> и <Cmd>/jetton адрес_жетона</Cmd>.
              </p>
            </Panel>
            <Panel className="space-y-2">
              <p className="text-[13px] font-semibold text-accent">Шаг 4 · Пул</p>
              <p className="font-bold">Активируйте и пополните пул</p>
              <p className="text-[15px] leading-relaxed text-hint">
                В <Ext href={APP_URL}>мини-приложении</Ext> → «My chats» → ваш чат: «Activate pool», затем «Make this wallet
                the admin» и «Top up» — введите, сколько жетонов перевести. Подтверждаете каждое действие в кошельке.
              </p>
            </Panel>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <PrimaryCta href="/help">Пошаговая инструкция</PrimaryCta>
            <SecondaryCta href={ADD_TO_GROUP_URL}>Добавить бота в группу</SecondaryCta>
          </div>
        </Section>

        {/* Pricing */}
        <Section
          id="pricing"
          eyebrow="Стоимость"
          title="Кто и за что платит"
          lead="Подписки нет, процента с жетонов нет. Achivator зарабатывает только фиксированную комиссию в TON с пополнений пула. Остальное — газ сети TON, он уходит валидаторам, а не нам."
        >
          <Panel>
            <PriceRow what="Ачивки и баллы" who="Бот, медали и учёт баллов работают сразу после добавления бота.">
              Бесплатно
            </PriceRow>
            <PriceRow
              what="Активация пула"
              who={`Разово. ${ton(100000000)} TON остаётся на счету контракта пула как резерв на хранение, остальное — газ и Achivator.`}
            >
              {ton(GAS.createPoolTon)} TON
            </PriceRow>
            <PriceRow what="Назначение админ-кошелька" who="Разово, газ сети.">
              {ton(GAS.setAdminTon)} TON
            </PriceRow>
            <PriceRow
              what="Пополнение пула"
              who={`Комиссия Achivator за каждое пополнение, плюс около ${depositGas} TON газа на перевод. С суммы жетонов не берётся ничего.`}
            >
              <span className="block space-y-0.5">
                {tiers.map((t, i) => (
                  <span key={t.tier} className="block">
                    {fmt(t.feeTon)} TON <span className="text-[13px] font-normal text-hint">· {tierLabel(tiers, i)}</span>
                  </span>
                ))}
              </span>
            </PriceRow>
            <PriceRow what="Пауза, лимит, вывод остатка" who="Газ сети. За паузу и лимит неизрасходованный TON возвращается.">
              {ton(GAS.adminControlTon)}–{ton(GAS.withdrawTon)} TON
            </PriceRow>
            <PriceRow
              what="Выплата участнику"
              who="Газ платит сам участник, при нажатии «Claim». Неизрасходованное возвращается ему вместе с жетонами."
            >
              до {ton(GAS.claimTon)} TON
            </PriceRow>
          </Panel>
          <p className="text-[14px] leading-relaxed text-hint">
            Точную сумму каждой транзакции вы видите в кошельке до подтверждения. Комиссию получает проект Achivator: она
            приходит на его мастер-контракт, и забрать её оттуда может только владелец этого контракта.
          </p>
        </Section>

        {/* Guarantees */}
        <Section
          id="guarantees"
          eyebrow="Гарантии"
          title="Что зашито в контракт, а что держится на доверии"
          lead="Мы не просим верить на слово. Вот честное разделение: что обеспечивает блокчейн, а где вы полагаетесь на наш сервис."
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Panel className="space-y-4">
              <div className="flex items-center gap-2">
                <Lock className="h-5 w-5 text-success" />
                <p className="font-bold">Обеспечивает смарт-контракт</p>
              </div>
              <ul className="space-y-4">
                <Guarantee icon={<Check className="mt-0.5 h-5 w-5 shrink-0 text-success" />} title="Жетоны лежат в контракте вашего чата">
                  Не на кошельке Achivator. У каждого чата свой пул, адрес виден в мини-приложении и в любом обозревателе
                  TON.
                </Guarantee>
                <Guarantee icon={<Check className="mt-0.5 h-5 w-5 shrink-0 text-success" />} title="Вывести остаток можете только вы">
                  Вывод, пауза и лимит принимаются только от админ-кошелька пула. У Achivator такой команды нет ни в
                  контракте пула, ни в мастер-контракте.
                </Guarantee>
                <Guarantee icon={<Check className="mt-0.5 h-5 w-5 shrink-0 text-success" />} title="Админа не подменить">
                  Передать права на пул может только текущий админ. Пока админ не назначен, пул возвращает любые пополнения
                  отправителю.
                </Guarantee>
                <Guarantee icon={<Check className="mt-0.5 h-5 w-5 shrink-0 text-success" />} title="Лимит на выплаты в сутки">
                  По умолчанию не больше {DAILY_LIMIT_PERCENT}% пула в день, можно задать своё число. Даже в худшем случае
                  пул не опустеет за один день.
                </Guarantee>
                <Guarantee icon={<Check className="mt-0.5 h-5 w-5 shrink-0 text-success" />} title="Одноразовые чеки">
                  Каждый чек на выплату подписан для конкретного пула, действует час и принимается один раз.
                </Guarantee>
              </ul>
            </Panel>
            <Panel className="space-y-4">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-[color:var(--gold-text)]" />
                <p className="font-bold">Держится на доверии к сервису</p>
              </div>
              <ul className="space-y-4">
                <Guarantee icon={<Info className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--gold-text)]" />} title="Баллы считает наш сервер">
                  Бот записывает реакции и выдачи в базу Achivator. Сами баллы — не в блокчейне, пока участник их не
                  забрал.
                </Guarantee>
                <Guarantee icon={<Info className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--gold-text)]" />} title="Чеки подписывает ключ сервера">
                  Поэтому контракт и ограничивает выплаты дневным лимитом. Если что-то пойдёт не так — поставьте выплаты на
                  паузу и замените ключ: подписи старого ключа перестанут работать сразу.
                </Guarantee>
                <Guarantee icon={<Info className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--gold-text)]" />} title="Если Achivator закроется">
                  Участники не смогут забрать ещё не выплаченные баллы. Но жетоны из пула вы выведете сами, напрямую
                  через контракт, — наш сервер для этого не нужен.
                </Guarantee>
                <Guarantee icon={<Info className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--gold-text)]" />} title="Размер комиссии назначает сервис">
                  Контракт его не ограничивает. Сумма всегда видна в кошельке до подписи, а тарифы опубликованы выше.
                </Guarantee>
              </ul>
            </Panel>
          </div>
          <p className="text-[15px] leading-relaxed text-hint">
            Весь код — контракты, бот и мини-приложение — открыт: <Ext href={GITHUB_URL}>github.com/achivator</Ext>.
            Проверьте сами или попросите знакомого разработчика.
          </p>
        </Section>

        {/* Anti-farming */}
        <Section
          id="antifraud"
          eyebrow="Защита от накруток"
          title="Почему баллы не накрутить твинками"
          lead="Реакции дёшево подделать, поэтому бот платит только за реакции, похожие на настоящие."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [<Users key="i" className="h-5 w-5" />, `${MIN_REACTOR_MESSAGES}+ сообщений`, "Реакции от тех, кто написал в чате меньше пяти сообщений, баллов не приносят."],
              [<Shield key="i" className="h-5 w-5" />, `${PAIR_DAILY_CAP} в день от одного`, "Один человек может принести другому не больше пяти оплаченных реакций в сутки."],
              [<Coins key="i" className="h-5 w-5" />, `${RECEIVER_DAILY_CAP} баллов в день`, "Потолок заработка на реакциях для одного участника в сутки."],
              [<Clock key="i" className="h-5 w-5" />, `${MATURATION_DAYS} дня дозревания`, "До выплаты есть время заметить подозрительное и поставить выплаты на паузу."],
            ].map(([icon, title, body]) => (
              <Panel key={title} className="space-y-2">
                <IconTile>{icon}</IconTile>
                <p className="font-bold">{title}</p>
                <p className="text-[14px] leading-relaxed text-hint">{body}</p>
              </Panel>
            ))}
          </div>
          <p className="text-[14px] text-hint">
            Значения по умолчанию. В карточке участника видно, от кого пришли его баллы, — «кольцо» из пары аккаунтов
            заметно сразу.
          </p>
        </Section>

        {/* Achievements */}
        <Section
          id="achievements"
          eyebrow="Бонус"
          title="Ачивки за стиль общения — с первой минуты"
          lead="Ещё до жетонов бот раздаёт медали: за первый код в чате, голосовое, сообщение ровно в полночь, первую сотню сообщений. Их видно в мини-приложении, а в будущем — можно будет выпустить как NFT."
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
        <Section id="faq" eyebrow="Вопросы" title="Частые вопросы">
          <Panel className="py-1">
            <Faq q="Это криптоинвестиция? Жетон вырастет в цене?">
              <p>
                Нет. Жетон здесь — баллы лояльности вашего сообщества, как мили у авиакомпании. Его ценность — то, что вы за
                него даёте. Achivator не торгует жетонами, не выводит их на биржи и ничего не обещает про курс.
              </p>
            </Faq>
            <Faq q="Зачем тогда блокчейн, почему не обычные баллы?">
              <p>
                Чтобы награда не зависела от доброй воли сервиса. Правила выплат исполняет контракт, а выплаченные жетоны
                принадлежат участнику: их не аннулировать задним числом, они не пропадут вместе с сервисом и видны в любом
                TON-кошельке.
              </p>
            </Faq>
            <Faq q="Нужно ли разбираться в крипте?">
              <p>
                Владельцу — на уровне «установить кошелёк и подтвердить транзакцию»: пошаговая{" "}
                <Link href="/help" className="font-medium text-link">
                  инструкция
                </Link>{" "}
                занимает 15–20 минут. Участникам нужен TON-кошелёк и немного TON на газ, чтобы забрать награду.
              </p>
            </Faq>
            <Faq q="Бот читает нашу переписку?">
              <p>
                Бот видит сообщения, потому что он админ, но хранит только статистику: кто, когда и какого типа сообщение
                написал и какие реакции получил. Тексты сообщений не сохраняются.
              </p>
            </Faq>
            <Faq q="Можно наградить не жетоном, который я выпустил, а уже существующим?">
              <p>
                Да, подойдёт любой жетон стандарта TON (TEP-74): укажите адрес его мастер-контракта командой{" "}
                <Cmd>/jetton</Cmd>.
              </p>
            </Faq>
            <Faq q="Кто может подключить чат и начислять баллы?">
              <p>
                Привязать жетон и управлять пулом может только создатель группы. Начислять баллы командой{" "}
                <Cmd>/reward</Cmd> — создатель и любые администраторы, в том числе боты-администраторы.
              </p>
            </Faq>
            <Faq q="Что если я передумаю?">
              <p>
                Поставьте выплаты на паузу и выведите остаток жетонов из пула на свой кошелёк. Уже выплаченное остаётся у
                участников.
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
                Попробуйте на своём чате
              </h2>
              <p className="text-[16px] leading-relaxed opacity-90">
                Ачивки заработают сразу после добавления бота. Жетоны — когда будете готовы: 15–20 минут по инструкции
                {testnet ? ", на бесплатных тестовых монетах" : ""}.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/help"
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-6 text-[15px] font-semibold text-[#1d4ed8] active:opacity-85"
                >
                  Подключить свой чат
                </Link>
                <a
                  href={APP_URL}
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-white/20 px-6 text-[15px] font-semibold active:opacity-85"
                >
                  Открыть в Telegram
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 border-t border-[color:var(--separator)] px-4 py-6 text-[14px] text-hint md:px-6">
        <span>Achivator · награды и ачивки для Telegram-чатов</span>
        <div className="flex flex-wrap gap-4">
          <Link href="/help" className="hover:text-fg">Инструкция</Link>
          <a href={CHANNEL_URL} className="hover:text-fg">Канал</a>
          <a href="https://t.me/achivator_bot" className="hover:text-fg">@achivator_bot</a>
          <a href={GITHUB_URL} className="hover:text-fg">GitHub</a>
        </div>
      </footer>
    </div>
  );
}
