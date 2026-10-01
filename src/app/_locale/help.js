import { Card } from "@/components/ui";
import { BrandMark } from "@/components/brand";
import { Check, Info } from "@/components/icons";
import { TelegramBack } from "@/components/TelegramBack";
import { LangSwitch } from "@/components/LangSwitch";
import { HomeLink } from "@/components/HomeLink";
import { localeMetadata } from "@/lib/locale";

// Setup guide for chat creators (testnet), at /ru/help and /en/help (the bare
// /help redirects to one, see lib/locale.js). A plain server page, not
// wrapped in AppShell: it must open in a regular browser too, not only
// inside Telegram.

export function helpMetadata(locale) {
  const en = locale === "en";
  return localeMetadata({
    locale,
    page: "/help",
    title: en ? "How to connect a chat to Achivator" : "Как подключить чат к Achivator",
    description: en
      ? "A step-by-step guide for Telegram group creators: testnet wallet, your own jetton, the @achivator_bot bot, reward pool."
      : "Пошаговая инструкция для создателя Telegram-группы: тестнет-кошелёк, свой жетон, бот @achivator_bot, пул наград.",
  });
}

const APP_URL = "https://t.me/achivator_bot/app";
const MINTER_URL = "https://minter.ton.org/?testnet=true";

function Ext({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-link underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

function Bot({ name }) {
  return <Ext href={`https://t.me/${name}`}>@{name}</Ext>;
}

function Cmd({ children }) {
  return (
    <code className="rounded-md bg-bg px-1.5 py-0.5 font-mono text-[13px] text-fg [overflow-wrap:anywhere]">{children}</code>
  );
}

function Done({ label, children }) {
  return (
    <div className="tint-success flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] leading-snug text-fg">
      <Check className="mt-px h-4 w-4 shrink-0 text-success" />
      <span>
        <b>{label}</b> {children}
      </span>
    </div>
  );
}

function Tip({ children }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-dashed border-[color:var(--control-border)] px-3 py-2.5 text-[13px] leading-snug">
      <Info className="mt-px h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function Step({ n, id, title, children }) {
  return (
    <Card id={id} className="scroll-mt-4 space-y-3">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-button text-[14px] font-bold text-accent-fg tabular">
          {n}
        </span>
        <h2 className="brand-heading text-[18px] leading-tight">{title}</h2>
      </div>
      <div className="space-y-3 text-[15px] leading-relaxed">{children}</div>
    </Card>
  );
}

function Steps({ children }) {
  return <ol className="list-decimal space-y-1.5 pl-5 marker:text-hint">{children}</ol>;
}

function Faq({ q, children }) {
  return (
    <details className="group border-t border-[color:var(--separator)] first:border-t-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 font-semibold [&::-webkit-details-marker]:hidden">
        {q}
        <span className="text-hint transition group-open:rotate-45">+</span>
      </summary>
      <div className="space-y-2 pb-3 text-[14px] leading-relaxed text-hint">{children}</div>
    </details>
  );
}

function Guide({ locale }) {
  const en = locale === "en";
  const L = (ruText, enText) => (en ? enText : ruText);
  const done = L("Готово, если", "Done when");
  const [open, close] = en ? ["“", "”"] : ["«", "»"];
  // A UI label exactly as the app or wallet shows it.
  const Ui = ({ children }) => (
    <span className="font-semibold text-fg">
      {open}
      {children}
      {close}
    </span>
  );

  const toc = [
    ["wallet", L("Тестнет-кошелёк", "Testnet wallet")],
    ["ton", L("Тестовые TON", "Test TON")],
    ["jetton", L("Свой жетон", "Your jetton")],
    ["bot", L("Бот в группе", "Bot in the group")],
    ["admin", L("Бот — админ", "Bot as admin")],
    ["commands", L("Команды боту", "Bot commands")],
    ["pool", L("Активация пула", "Pool activation")],
    ["pool-admin", L("Админ-кошелёк пула", "Pool admin wallet")],
    ["topup", L("Пополнение пула", "Pool top-up")],
  ];

  return (
    <main className="pb-safe mx-auto flex min-h-screen max-w-xl flex-col gap-5 px-4">
      <header className="flex items-center justify-between gap-3 py-3">
        <HomeLink locale={locale} className="flex items-center gap-2" aria-label="Achivator">
          <BrandMark />
          <span className="brand-heading text-[17px]">Achivator</span>
        </HomeLink>
        <div className="flex items-center gap-2">
          <span className="mono-label rounded-md border border-[color:color-mix(in_srgb,var(--gold)_55%,transparent)] px-2 py-1 text-[color:var(--gold-text)]">
            {L("Тестнет", "Testnet")}
          </span>
          <LangSwitch locale={locale} page="/help" />
        </div>
      </header>

      <section className="space-y-2">
        <h1 className="brand-heading text-[30px] leading-tight text-balance">
          {L("Как подключить свой чат", "How to connect your chat")}
        </h1>
        <p className="text-[15px] leading-relaxed text-hint">
          {L(
            "Инструкция для создателя группы: от тестового кошелька до пула, из которого участники забирают награды жетонами. Всё происходит в тестовой сети TON — деньги настоящие не нужны. Займёт 15–20 минут.",
            "A guide for the group's creator: from a test wallet to the pool members claim their jetton rewards from. Everything happens on the TON testnet — no real money needed. Takes 15–20 minutes.",
          )}
        </p>
      </section>

      <Card className="space-y-2">
        <p className="card-title">{L("Что понадобится", "What you need")}</p>
        <ul className="list-disc space-y-1 pl-5 text-[15px] leading-relaxed marker:text-hint">
          <li>
            {L("Telegram-группа, где вы —", "A Telegram group where you are the")} <b>{L("создатель", "creator")}</b>{" "}
            {L("(владелец). Обычному админу подключить чат нельзя.", "(owner). A regular admin can't connect a chat.")}
          </li>
          <li>
            {L("Кошелёк", "The")} <Ext href="https://tonkeeper.com">Tonkeeper</Ext> {L("на телефоне.", "wallet on your phone.")}
          </li>
          <li>{L("Около 2 тестовых TON — их бесплатно раздают боты.", "About 2 test TON — bots hand them out for free.")}</li>
        </ul>
      </Card>

      <nav aria-label={L("Шаги", "Steps")} className="flex flex-wrap gap-2">
        {toc.map(([name, label], i) => (
          <a
            key={name}
            href={`#${name}`}
            className="rounded-[7px] border border-[color:var(--control-border)] bg-surface px-2.5 py-1.5 text-[13px] font-medium"
          >
            <span className="mono-label text-hint">{String(i + 1).padStart(2, "0")}</span> {label}
          </a>
        ))}
      </nav>

      <Step n={1} id="wallet" title={L("Заведите тестнет-кошелёк", "Create a testnet wallet")}>
        <Steps>
          <li>
            {L(
              "Установите Tonkeeper и создайте обычный кошелёк, если его ещё нет.",
              "Install Tonkeeper and create a regular wallet if you don't have one yet.",
            )}
          </li>
          <li>
            {L("Откройте", "Open")} <Ui>Settings</Ui>{" "}
            {L(
              "(Настройки) и 5 раз быстро коснитесь логотипа Tonkeeper внизу экрана — появится",
              "and quickly tap the Tonkeeper logo at the bottom of the screen 5 times —",
            )}{" "}
            <Ui>Dev Menu</Ui>
            {L(".", " appears.")}
          </li>
          <li>
            {L("Нажмите на название кошелька вверху главного экрана →", "Tap the wallet name at the top of the main screen →")}{" "}
            <Ui>Add Wallet</Ui> → <Ui>Testnet Account</Ui>.
          </li>
          <li>
            {L(
              "Введите фразу восстановления из 24 слов. Подойдёт и фраза основного кошелька — балансы в тестнете отдельные, — но спокойнее завести для тестов отдельный кошелёк.",
              "Enter a 24-word recovery phrase. Your main wallet's phrase works too — testnet balances are separate — but a dedicated test wallet is the safer choice.",
            )}
          </li>
          <li>
            {L("Скопируйте адрес тестнет-кошелька — он начинается на", "Copy the testnet wallet address — it starts with")}{" "}
            <Cmd>0Q…</Cmd> {L("или", "or")} <Cmd>kQ…</Cmd>.
          </li>
        </Steps>
        <Tip>
          {L(
            "Кошелёк внутри Telegram (@wallet) тестнет не поддерживает. Подойдёт любой другой кошелёк с тестнетом, который подключается через TON Connect.",
            "The wallet built into Telegram (@wallet) doesn't support the testnet. Any other testnet wallet that connects via TON Connect will do.",
          )}
        </Tip>
        <Done label={done}>
          {L(
            "в списке кошельков Tonkeeper есть кошелёк с пометкой Testnet.",
            "Tonkeeper's wallet list has a wallet marked Testnet.",
          )}
        </Done>
      </Step>

      <Step n={2} id="ton" title={L("Получите тестовые TON", "Get test TON")}>
        <Steps>
          <li>
            {L("Откройте бота", "Open")} <Bot name="testgiver_ton_bot" />
            {L(
              ", отправьте ему адрес тестнет-кошелька и пройдите проверку.",
              ", send it your testnet wallet address and pass the check.",
            )}
          </li>
          <li>
            {L("Если бот не отвечает или просит подождать — попробуйте", "If it doesn't reply or asks you to wait, try")}{" "}
            <Bot name="tnfaucet_bot" />.
          </li>
        </Steps>
        <p className="text-hint">
          {L(
            "На что уйдут TON: выпуск жетона, активация пула (кошелёк отправит 0,3 TON, 0,1 TON останутся на контракте пула, остальное вернётся), назначение админ-кошелька (0,05 TON) и газ каждого пополнения пула (кошелёк отправит 0,25 TON, неизрасходованное вернётся). Комиссии Achivator в TON нет. 2 TON хватит с запасом, а если закончатся — просто запросите ещё.",
            "What the TON is for: issuing the jetton, activating the pool (your wallet sends 0.3 TON, 0.1 TON stays on the pool contract, the rest comes back), setting the admin wallet (0.05 TON) and the gas of each pool top-up (your wallet sends 0.25 TON, what is not spent comes back). Achivator takes no fee in TON. 2 TON is plenty, and if you run out, just ask for more.",
          )}
        </p>
        <Done label={done}>
          {L("в Tonkeeper на тестнет-кошельке ненулевой баланс TON.", "the testnet wallet in Tonkeeper has a non-zero TON balance.")}
        </Done>
      </Step>

      <Step n={3} id="jetton" title={L("Выпустите (сминтите) свой жетон", "Issue (mint) your jetton")}>
        <p>
          {L(
            "Жетон — это токен, которым чат награждает участников. Выпустить его проще всего в TON Minter:",
            "A jetton is the token your chat rewards members with. The easiest way to issue one is TON Minter:",
          )}
        </p>
        <Steps>
          <li>
            {L("Откройте", "Open")} <Ext href={MINTER_URL}>minter.ton.org/?testnet=true</Ext> — {L("параметр", "the")}{" "}
            <Cmd>testnet=true</Cmd>{" "}
            {L("важен, без него минтер работает в основной сети.", "parameter matters: without it the minter works on mainnet.")}
          </li>
          <li>
            {L("Нажмите", "Tap")} <Ui>Connect Wallet</Ui> → Tonkeeper{" "}
            {L("и выберите тестнет-кошелёк.", "and pick the testnet wallet.")}
          </li>
          <li>
            {L("Заполните форму:", "Fill in the form:")} <b>Name</b>{" "}
            {L("(например, «Монеты нашего чата»),", "(for example, “Our chat coins”),")} <b>Symbol</b>{" "}
            {L("(коротко, 3–5 латинских букв, например", "(short, 3–5 Latin letters, e.g.")} <Cmd>CHAT</Cmd>),{" "}
            <b>Decimals</b> — {L("оставьте 9,", "keep 9,")} <b>Tokens to mint</b> —{" "}
            {L(
              "сколько выпустить, например 1 000 000. Описание и ссылка на картинку — по желанию.",
              "how many to issue, e.g. 1,000,000. Description and image link are optional.",
            )}
          </li>
          <li>
            {L("Нажмите", "Tap")} <Ui>Deploy</Ui>{" "}
            {L(
              "и подтвердите транзакцию в кошельке. Весь выпуск придёт на ваш кошелёк.",
              "and confirm the transaction in your wallet. The whole supply lands in your wallet.",
            )}
          </li>
          <li>
            {L("Когда страница жетона откроется, скопируйте", "When the jetton page opens, copy the")}{" "}
            <b>{L("адрес жетона", "jetton address")}</b>{" "}
            {L(
              "(адрес мастер-контракта, Jetton address). Он понадобится на шаге 6.",
              "(the master contract address, “Jetton address”). You'll need it in step 6.",
            )}
          </li>
        </Steps>
        <Tip>
          {L(
            "Нужен именно адрес мастер-контракта жетона — не адрес вашего кошелька и не адрес «jetton wallet». В Tonkeeper его видно в карточке жетона, а в минтере — в адресной строке страницы жетона.",
            "You need the jetton's master contract address — not your wallet address and not a “jetton wallet” address. Tonkeeper shows it on the jetton card; in the minter it's in the jetton page's URL.",
          )}
        </Tip>
        <Done label={done}>
          {L(
            "в Tonkeeper на тестнет-кошельке появился ваш жетон с выпущенным количеством.",
            "your jetton shows up in the testnet wallet in Tonkeeper with the minted amount.",
          )}
        </Done>
      </Step>

      <Step n={4} id="bot" title={L("Добавьте @achivator_bot в группу", "Add @achivator_bot to the group")}>
        <Steps>
          <li>
            {L("Откройте группу → нажмите на её название →", "Open the group → tap its name →")}{" "}
            <Ui>{L("Добавить участников", "Add Members")}</Ui>.
          </li>
          <li>
            {L("Найдите", "Find")} <Bot name="achivator_bot" /> {L("и добавьте.", "and add it.")}
          </li>
        </Steps>
        <Done label={done}>
          {L("бот написал в группе приветствие", "the bot posted its greeting in the group:")} {open}
          {L("Привет! Я Achivator Bot…", "Hello! I'm the Achivator Bot…")}
          {close}.
        </Done>
      </Step>

      <Step n={5} id="admin" title={L("Сделайте бота администратором", "Make the bot an admin")}>
        <Steps>
          <li>
            {L("Профиль группы →", "Group profile →")} <Ui>{L("Изменить", "Edit")}</Ui> →{" "}
            <Ui>{L("Администраторы", "Administrators")}</Ui> → <Ui>{L("Добавить администратора", "Add Admin")}</Ui>.
          </li>
          <li>
            {L(
              "Выберите achivator_bot и сохраните. Права по умолчанию подходят.",
              "Pick achivator_bot and save. The default rights are fine.",
            )}
          </li>
        </Steps>
        <p className="text-hint">
          {L(
            "Права админа нужны, чтобы бот видел сообщения и реакции и мог проверить, кто отдаёт ему команды. Бот хранит только статистику, а не тексты сообщений.",
            "Admin rights let the bot see messages and reactions and check who sends it commands. The bot stores statistics only, not message texts.",
          )}
        </p>
        <Done label={done}>
          {L("бот ответил", "the bot replied")} {open}
          {L("Спасибо за права администратора!…", "Thank you for granting me admin rights!…")}
          {close}.
        </Done>
      </Step>

      <Step n={6} id="commands" title={L("Отправьте команды боту", "Send the bot its commands")}>
        <p>{L("Пишите прямо в группе, от своего аккаунта создателя:", "Type them right in the group, from your creator account:")}</p>
        <div className="space-y-3">
          <div className="space-y-1">
            <Cmd>/verify@achivator_bot</Cmd>
            <p className="text-hint">
              {L("Подтверждает, что вы создатель чата. Бот ответит", "Confirms you are the chat's creator. The bot replies")} {open}
              {L("Подтверждено: вы создатель.", "Verified. You are creator.")}
              {close}
            </p>
          </div>
          <div className="space-y-1">
            <Cmd>{L("/jetton EQ…адрес_жетона", "/jetton EQ…jetton_address")}</Cmd>
            <p className="text-hint">
              {L(
                "Привязывает жетон из шага 3 как награду чата. Бот ответит «Жетон для наград задан: …». Команда",
                "Sets the jetton from step 3 as the chat's reward. The bot replies “Reward jetton set: …”.",
              )}{" "}
              <Cmd>/jetton</Cmd> {L("без адреса покажет текущий жетон.", "without an address shows the current jetton.")}
            </p>
          </div>
        </div>
        <Tip>
          {L(
            "Если в ваших правах администратора включена «Анонимность», отключите её: бот не видит, кто отправил анонимное сообщение, и не примет команду.",
            "If “Remain Anonymous” is on in your admin rights, turn it off: the bot can't see who sent an anonymous message and won't accept the command.",
          )}
        </Tip>
        <Done label={done}>{L("бот подтвердил оба действия.", "the bot confirmed both.")}</Done>
      </Step>

      <Step n={7} id="pool" title={L("Активируйте пул наград", "Activate the reward pool")}>
        <p>
          {L(
            "Пул — это смарт-контракт вашего чата, из которого участники забирают жетоны.",
            "The pool is your chat's smart contract that members claim their jettons from.",
          )}
        </p>
        <Steps>
          <li>
            {L("Откройте мини-приложение:", "Open the mini app:")} <Ext href={APP_URL}>t.me/achivator_bot/app</Ext>{" "}
            {L("(или кнопка в чате с ботом).", "(or the button in the chat with the bot).")}
          </li>
          <li>
            {L("Вверху справа нажмите", "At the top right tap")} <Ui>{L("Подключить кошелёк", "Connect Wallet")}</Ui> → Tonkeeper{" "}
            {L("и выберите", "and pick the")} <b>{L("тестнет", "testnet")}</b>{L("-кошелёк.", " wallet.")}
          </li>
          <li>
            {L("В разделе", "In")} <Ui>{L("Мои чаты", "My chats")}</Ui>{" "}
            {L("выберите свою группу — откроется страница пула.", "pick your group — its pool page opens.")}
          </li>
          <li>
            {L("Нажмите", "Tap")} <Ui>{L("Активировать пул", "Activate pool")}</Ui>{" "}
            {L(
              "и подтвердите в кошельке 0,3 TON. Это разовая операция: 0,1 TON останутся на контракте пула на оплату его хранения в сети, остальное за вычетом газа вернётся.",
              "and confirm 0.3 TON in your wallet. It's a one-off: 0.1 TON stays on the pool contract to pay its network storage, the rest comes back minus gas.",
            )}
          </li>
        </Steps>
        <Done label={done}>
          {L(
            "у чата появилась зелёная метка «Пул активен» (обычно в течение минуты).",
            "the chat shows a green “Pool active” badge (usually within a minute).",
          )}
        </Done>
      </Step>

      <Step n={8} id="pool-admin" title={L("Назначьте админ-кошелёк пула", "Set the pool's admin wallet")}>
        <Steps>
          <li>
            {L("На той же странице в блоке", "On the same page, in the")} <Ui>{L("Шаг 1 · Админ-кошелёк", "Step 1 · Admin wallet")}</Ui>{" "}
            {L("нажмите", "block tap")} <Ui>{L("Сделать этот кошелёк админом", "Make this wallet the admin")}</Ui>.
          </li>
          <li>{L("Подтвердите транзакцию (0,05 TON).", "Confirm the transaction (0.05 TON).")}</li>
        </Steps>
        <p className="text-hint">
          {L(
            "Только этот кошелёк сможет выводить жетоны из пула, ставить дневной лимит выплат и паузу. Шаг обязателен: пока у пула нет админа, он возвращает пополнения обратно.",
            "Only this wallet can withdraw jettons from the pool, set the daily payout limit and pause payouts. The step is required: until the pool has an admin, it sends deposits back.",
          )}
        </p>
        <Done label={done}>
          {L(
            "блок сменился на «Пополнение», а в карточке пула указан админ-кошелёк.",
            "the block turned into “Top up” and the pool card shows an Admin wallet.",
          )}
        </Done>
      </Step>

      <Step n={9} id="topup" title={L("Залейте жетоны в пул", "Fund the pool with jettons")}>
        <Steps>
          <li>
            {L("В блоке", "In the")} <Ui>{L("Пополнение", "Top up")}</Ui>{" "}
            {L(
              "введите, сколько жетонов перевести в пул — например, 100 000.",
              "block enter how many jettons to move into the pool — for example, 100,000.",
            )}
          </li>
          <li>
            {L("Нажмите", "Tap")} <Ui>{L("Пополнить пул", "Top up pool")}</Ui>{" "}
            {L(
              "и подтвердите. В транзакцию входит только газ сети, комиссии нет; неизрасходованные TON вернутся.",
              "and confirm. The transaction carries only network gas, no fee; the TON that is not spent comes back.",
            )}
          </li>
        </Steps>
        <Done label={done}>
          {L(
            "в карточке «Пул наград» виден баланс жетонов. Чат подключён!",
            "the “Reward pool” card shows the jetton balance. Your chat is connected!",
          )}
        </Done>
      </Step>

      <section className="space-y-2.5">
        <h2 className="mono-label px-1 text-hint">{L("Что дальше", "What's next")}</h2>
        <Card className="space-y-3 text-[15px] leading-relaxed">
          <p>
            <b>{L("Баллы за реакции.", "Points for reactions.")}</b>{" "}
            {L(
              "Участники получают баллы, когда их сообщениям ставят позитивные реакции:",
              "Members earn points when their messages get positive reactions:",
            )}{" "}
            👍 ❤ 🔥 ❤‍🔥 🎉 😍 🥰 👏 💯 🤩 😁 🤣 🙏 🤝 🏆 👌 ⚡ 🫡 😎 🤗 😇 💘 🍾 🆒.{" "}
            {L(
              "Считаются любые сообщения — текст, фото, стикеры, голосовые, — но только написанные после того, как бот стал админом. Платные звёзды, премиум-эмодзи и анонимные реакции в каналах баллов не дают. Реакции на сообщения создателя стоят больше. Чтобы реакции засчитывались, у реагирующего должно быть хотя бы 5 сообщений в чате, а число реакций от одного человека другому в день ограничено — так сложнее накручивать.",
              "Any message counts — text, photos, stickers, voice — but only those written after the bot became an admin. Paid stars, premium emoji and anonymous reactions in channels earn nothing. Reactions to the creator's messages are worth more. For a reaction to count, the person reacting needs at least 5 messages in the chat, and the number of reactions one person can give another per day is capped — that makes farming harder.",
            )}
          </p>
          <p>
            <b>{L("Ручные награды.", "Manual rewards.")}</b>{" "}
            {L(
              "Вы и другие админы можете начислить баллы за что угодно: ответьте на сообщение командой",
              "You and other admins can grant points for anything: reply to a message with",
            )}{" "}
            <Cmd>{L("/reward 50 за помощь", "/reward 50 for helping")}</Cmd> {L("или напишите", "or send")}{" "}
            <Cmd>{L("/reward @username 50 причина", "/reward @username 50 reason")}</Cmd>.
          </p>
          <p>
            <b>{L("Правила выплат.", "Payout rules.")}</b> {L("На странице пула, в блоке", "On the pool page, the")}{" "}
            <Ui>{L("Правила вывода", "Claim rules")}</Ui>{" "}
            {L(
              "задаётся, через сколько дней баллы можно забрать (по умолчанию 3 дня), в какие дни недели открыты выплаты и пауза на отпуск.",
              "block sets how many days until points can be claimed (3 by default), which weekdays claims are open, and a vacation pause.",
            )}{" "}
            <b>{L("Для теста поставьте 0 дней", "For testing set 0 days")}</b>
            {L(", чтобы не ждать.", " so you don't have to wait.")}
          </p>
          <p>
            <b>{L("Цена балла.", "Point price.")}</b> {L("На странице пула, в блоке", "On the pool page, the")}{" "}
            <Ui>{L("Цена балла", "Point price")}</Ui>{" "}
            {L(
              "задаётся, сколько жетонов стоит один балл (по умолчанию — курс платформы). Цена действует и для уже накопленных баллов. Повышение применяется сразу, со следующей выплаты. Снижение вступает в силу только через 7 дней (позже, если вывод открыт не каждый день: до снижения у участников будет хотя бы один полный день вывода; пока оно запланировано, вывод нельзя приостановить): бот сразу объявляет его в чате, чтобы участники успели забрать баллы по текущей цене, и сообщает ещё раз, когда цена снизится. Каждое изменение участники видят в мини-приложении в течение 7 дней.",
              "block sets how many jettons one point is worth (the platform rate by default). The price also applies to points already earned. An increase applies at once, from the next claim. A decrease takes effect only after 7 days (later if claims aren't open every day: members get at least one full claim day before it; claims can't be paused while it is pending): the bot announces it in the chat right away so members can claim at the current price, and again when the price drops. Members see every change in the mini app for 7 days.",
            )}
          </p>
          <p>
            <b>{L("Язык бота.", "Bot language.")}</b>{" "}
            {L(
              "Бот отвечает на языке Telegram того, кто ему пишет. Чтобы закрепить язык для всего чата, создатель или админ отправляет",
              "The bot answers in the Telegram language of whoever writes to it. To fix one language for the whole chat, the creator or an admin sends",
            )}{" "}
            <Cmd>/lang ru</Cmd> {L("или", "or")} <Cmd>/lang en</Cmd>.
          </p>
          <p>
            <b>{L("Как участники забирают награду.", "How members claim.")}</b>{" "}
            {L("В мини-приложении, кнопкой", "In the mini app, with the")} <Ui>{L("Забрать", "Claim")}</Ui>
            {L(
              ". Им тоже нужен тестнет-кошелёк и немного тестовых TON на газ (около 0,15 TON за выплату).",
              " button. They also need a testnet wallet and a little test TON for gas (about 0.15 TON per payout).",
            )}
          </p>
          <p>
            <b>{L("Защита пула.", "Pool protection.")}</b>{" "}
            {L(
              "С админ-кошелька можно поставить выплаты на паузу, изменить дневной лимит (по умолчанию 10% пула в день) и вывести жетоны обратно. Эти ограничения зашиты в контракт и действуют, даже если что-то случится с ботом.",
              "From the admin wallet you can pause payouts, change the daily limit (10% of the pool per day by default) and withdraw jettons back. These limits are built into the contract and hold even if something happens to the bot.",
            )}
          </p>
        </Card>
      </section>

      <section className="space-y-2.5">
        <h2 className="mono-label px-1 text-hint">
          {L("Если что-то не так", "Troubleshooting")}
        </h2>
        <Card className="py-1">
          <Faq q={L("Моего чата нет в «Мои чаты»", "My chat isn't in “My chats”")}>
            <p>
              {L("Чат появляется там после", "A chat appears there after")} <Cmd>/verify@achivator_bot</Cmd> {L("или", "or")}{" "}
              <Cmd>/jetton</Cmd>
              {L(
                ", отправленных создателем в группе. Отправьте команду и перезапустите мини-приложение.",
                " sent by the creator in the group. Send the command and restart the mini app.",
              )}
            </p>
          </Faq>
          <Faq q={L("Бот не реагирует на команды", "The bot ignores commands")}>
            <p>
              {L(
                "Проверьте, что бот — администратор группы (шаг 5). Если в группе несколько ботов, пишите команду с упоминанием:",
                "Check that the bot is a group admin (step 5). If the group has several bots, mention it in the command:",
              )}{" "}
              <Cmd>/jetton@achivator_bot …</Cmd>.
            </p>
          </Faq>
          <Faq q={L("Бот пишет «Я не вижу, кто это отправил»", "The bot says “I cannot see who sent this”")}>
            <p>
              {L(
                "Вы пишете анонимно или от имени канала. Отключите «Анонимность» в своих правах администратора и отправьте команду от своего имени.",
                "You are posting anonymously or as a channel. Turn off “Remain Anonymous” in your admin rights and send the command as yourself.",
              )}
            </p>
          </Faq>
          <Faq q={L("«Задать жетон для наград может только создатель чата»", "“Only the chat creator can set the reward jetton”")}>
            <p>
              {L(
                "Привязать жетон и управлять пулом может только создатель группы. Остальные админы могут начислять баллы командой",
                "Only the group's creator can set the jetton and manage the pool. Other admins can grant points with",
              )}{" "}
              <Cmd>/reward</Cmd>.
            </p>
          </Faq>
          <Faq q={L("Бот не принимает адрес жетона", "The bot rejects the jetton address")}>
            <p>
              {L("Нужен адрес мастер-контракта жетона целиком — он начинается на", "It needs the full jetton master contract address — starting with")}{" "}
              <Cmd>EQ</Cmd>, <Cmd>UQ</Cmd>, <Cmd>kQ</Cmd> {L("или", "or")} <Cmd>0Q</Cmd>.{" "}
              {L("Не путайте его с адресом своего кошелька.", "Don't confuse it with your wallet address.")}
            </p>
          </Faq>
          <Faq q={L("Кошелёк не подтверждает транзакцию или ругается на сеть", "The wallet won't confirm or complains about the network")}>
            <p>
              {L(
                "Скорее всего, подключён кошелёк основной сети. В мини-приложении нажмите на адрес кошелька вверху →",
                "Most likely a mainnet wallet is connected. In the mini app tap the wallet address at the top →",
              )}{" "}
              <Ui>{L("Отключить кошелёк", "Disconnect")}</Ui>{" "}
              {L("и подключите тестнет-кошелёк заново.", "and connect the testnet wallet again.")}
            </p>
          </Faq>
          <Faq q={L("Висит «Транзакция ещё подтверждается в сети»", "Stuck on “Still confirming on-chain”")}>
            <p>
              {L("Тестнет иногда тормозит. Подождите минуту и нажмите", "The testnet is sometimes slow. Wait a minute and tap")}{" "}
              <Ui>{L("Обновить", "Refresh")}</Ui> {L("внизу страницы пула.", "at the bottom of the pool page.")}
            </p>
          </Faq>
          <Faq q={L("Закончились тестовые TON", "Out of test TON")}>
            <p>
              {L("Запросите ещё у", "Ask")} <Bot name="testgiver_ton_bot" /> {L("или", "or")} <Bot name="tnfaucet_bot" />
              {L(".", " for more.")}
            </p>
          </Faq>
        </Card>
      </section>

      <a
        href={APP_URL}
        className="flex h-12 items-center justify-center rounded-xl bg-button px-5 text-[15px] font-semibold text-accent-fg active:opacity-80"
      >
        {L("Открыть Achivator в Telegram", "Open Achivator in Telegram")}
      </a>
    </main>
  );
}

export function HelpPage({ locale }) {
  return (
    <>
      <TelegramBack />
      <Guide locale={locale} />
    </>
  );
}
