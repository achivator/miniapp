import Link from "next/link";
import { Card } from "@/components/ui";
import { Check, Info, Medal } from "@/components/icons";
import { TelegramBack } from "@/components/TelegramBack";

// Setup guide for chat creators (testnet). A plain server page, not wrapped in
// AppShell: it must open in a regular browser too, not only inside Telegram.

export const metadata = {
  title: "Как подключить чат к Achivator (тестнет)",
  description:
    "Пошаговая инструкция для создателя Telegram-группы: тестнет-кошелёк, свой жетон, бот @achivator_bot, пул наград.",
};

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

// A UI label exactly as the app or wallet shows it.
function Ui({ children }) {
  return <span className="font-semibold text-fg">«{children}»</span>;
}

function Done({ children }) {
  return (
    <div className="tint-success flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] leading-snug text-success">
      <Check className="mt-px h-4 w-4 shrink-0" />
      <span>
        <b>Готово, если</b> {children}
      </span>
    </div>
  );
}

function Tip({ children }) {
  return (
    <div className="tint-accent flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] leading-snug text-accent">
      <Info className="mt-px h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function Step({ n, id, title, children }) {
  return (
    <Card id={id} className="scroll-mt-4 space-y-3">
      <div className="flex items-center gap-3">
        <span className="hero-gradient flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[15px] font-bold tabular">
          {n}
        </span>
        <h2 className="text-[17px] font-bold leading-tight">{title}</h2>
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

const TOC = [
  ["wallet", "Тестнет-кошелёк"],
  ["ton", "Тестовые TON"],
  ["jetton", "Свой жетон"],
  ["bot", "Бот в группе"],
  ["admin", "Бот — админ"],
  ["commands", "Команды боту"],
  ["pool", "Активация пула"],
  ["pool-admin", "Админ-кошелёк пула"],
  ["topup", "Пополнение пула"],
];

export default function HelpPage() {
  return (
    <main lang="ru" className="pb-safe mx-auto flex min-h-screen max-w-xl flex-col gap-5 px-4">
      <TelegramBack />

      <header className="flex items-center justify-between py-3">
        <Link href="/" className="flex items-center gap-2" aria-label="Achivator">
          <span className="hero-gradient flex h-8 w-8 items-center justify-center rounded-[10px]">
            <Medal className="h-[18px] w-[18px]" />
          </span>
          <span className="text-[17px] font-bold tracking-tight">Achivator</span>
        </Link>
        <span className="tint-gold rounded-full px-2.5 py-1 text-xs font-medium text-[color:var(--gold-text)]">Тестнет</span>
      </header>

      <section className="space-y-2">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-balance">Как подключить свой чат</h1>
        <p className="text-[15px] leading-relaxed text-hint">
          Инструкция для создателя группы: от тестового кошелька до пула, из которого участники забирают награды
          жетонами. Всё происходит в тестовой сети TON — деньги настоящие не нужны. Займёт 15–20 минут.
        </p>
      </section>

      <Card className="space-y-2">
        <p className="font-semibold">Что понадобится</p>
        <ul className="list-disc space-y-1 pl-5 text-[15px] leading-relaxed marker:text-hint">
          <li>
            Telegram-группа, где вы — <b>создатель</b> (владелец). Обычному админу подключить чат нельзя.
          </li>
          <li>
            Кошелёк <Ext href="https://tonkeeper.com">Tonkeeper</Ext> на телефоне.
          </li>
          <li>Около 2 тестовых TON — их бесплатно раздают боты.</li>
        </ul>
      </Card>

      <nav aria-label="Шаги" className="flex flex-wrap gap-2">
        {TOC.map(([id, label], i) => (
          <a key={id} href={`#${id}`} className="rounded-full bg-surface px-3 py-1.5 text-[13px] font-medium">
            <span className="text-hint tabular">{i + 1}.</span> {label}
          </a>
        ))}
      </nav>

      <Step n={1} id="wallet" title="Заведите тестнет-кошелёк">
        <Steps>
          <li>Установите Tonkeeper и создайте обычный кошелёк, если его ещё нет.</li>
          <li>
            Откройте <Ui>Settings</Ui> (Настройки) и 5 раз быстро коснитесь логотипа Tonkeeper внизу экрана —
            появится <Ui>Dev Menu</Ui>.
          </li>
          <li>
            Нажмите на название кошелька вверху главного экрана → <Ui>Add Wallet</Ui> → <Ui>Testnet Account</Ui>.
          </li>
          <li>
            Введите фразу восстановления из 24 слов. Подойдёт и фраза основного кошелька — балансы в тестнете
            отдельные, — но спокойнее завести для тестов отдельный кошелёк.
          </li>
          <li>
            Скопируйте адрес тестнет-кошелька — он начинается на <Cmd>0Q…</Cmd> или <Cmd>kQ…</Cmd>.
          </li>
        </Steps>
        <Tip>
          Кошелёк внутри Telegram (@wallet) тестнет не поддерживает. Подойдёт любой другой кошелёк с тестнетом,
          который подключается через TON Connect.
        </Tip>
        <Done>в списке кошельков Tonkeeper есть кошелёк с пометкой Testnet.</Done>
      </Step>

      <Step n={2} id="ton" title="Получите тестовые TON">
        <Steps>
          <li>
            Откройте бота <Bot name="testgiver_ton_bot" />, отправьте ему адрес тестнет-кошелька и пройдите
            проверку.
          </li>
          <li>
            Если бот не отвечает или просит подождать — попробуйте <Bot name="tnfaucet_bot" />.
          </li>
        </Steps>
        <p className="text-hint">
          На что уйдут TON: выпуск жетона, активация пула (0,3 TON), назначение админ-кошелька (0,05 TON) и каждое
          пополнение пула (около 0,35 TON: комиссия и газ). 2 TON хватит с запасом, а если закончатся — просто
          запросите ещё.
        </p>
        <Done>в Tonkeeper на тестнет-кошельке ненулевой баланс TON.</Done>
      </Step>

      <Step n={3} id="jetton" title="Выпустите (сминтите) свой жетон">
        <p>
          Жетон — это токен, которым чат награждает участников. Выпустить его проще всего в TON Minter:
        </p>
        <Steps>
          <li>
            Откройте <Ext href={MINTER_URL}>minter.ton.org/?testnet=true</Ext> — параметр <Cmd>testnet=true</Cmd>{" "}
            важен, без него минтер работает в основной сети.
          </li>
          <li>
            Нажмите <Ui>Connect Wallet</Ui> → Tonkeeper и выберите тестнет-кошелёк.
          </li>
          <li>
            Заполните форму: <b>Name</b> (например, «Монеты нашего чата»), <b>Symbol</b> (коротко, 3–5 латинских
            букв, например <Cmd>CHAT</Cmd>), <b>Decimals</b> — оставьте 9, <b>Tokens to mint</b> — сколько выпустить,
            например 1 000 000. Описание и ссылка на картинку — по желанию.
          </li>
          <li>
            Нажмите <Ui>Deploy</Ui> и подтвердите транзакцию в кошельке. Весь выпуск придёт на ваш кошелёк.
          </li>
          <li>
            Когда страница жетона откроется, скопируйте <b>адрес жетона</b> (адрес мастер-контракта, Jetton
            address). Он понадобится на шаге 6.
          </li>
        </Steps>
        <Tip>
          Нужен именно адрес мастер-контракта жетона — не адрес вашего кошелька и не адрес «jetton wallet». В
          Tonkeeper его видно в карточке жетона, а в минтере — в адресной строке страницы жетона.
        </Tip>
        <Done>в Tonkeeper на тестнет-кошельке появился ваш жетон с выпущенным количеством.</Done>
      </Step>

      <Step n={4} id="bot" title="Добавьте @achivator_bot в группу">
        <Steps>
          <li>
            Откройте группу → нажмите на её название → <Ui>Добавить участников</Ui>.
          </li>
          <li>
            Найдите <Bot name="achivator_bot" /> и добавьте.
          </li>
        </Steps>
        <Done>бот написал в группе приветствие «Hello! I&apos;m the Achivator Bot…».</Done>
      </Step>

      <Step n={5} id="admin" title="Сделайте бота администратором">
        <Steps>
          <li>
            Профиль группы → <Ui>Изменить</Ui> → <Ui>Администраторы</Ui> → <Ui>Добавить администратора</Ui>.
          </li>
          <li>Выберите achivator_bot и сохраните. Права по умолчанию подходят.</li>
        </Steps>
        <p className="text-hint">
          Права админа нужны, чтобы бот видел сообщения и реакции и мог проверить, кто отдаёт ему команды. Бот
          хранит только статистику, а не тексты сообщений.
        </p>
        <Done>бот ответил «Thank you for granting me admin rights!…».</Done>
      </Step>

      <Step n={6} id="commands" title="Отправьте команды боту">
        <p>Пишите прямо в группе, от своего аккаунта создателя:</p>
        <div className="space-y-3">
          <div className="space-y-1">
            <Cmd>/verify@achivator_bot</Cmd>
            <p className="text-hint">
              Подтверждает, что вы создатель чата. Бот ответит «Verified. You are creator.»
            </p>
          </div>
          <div className="space-y-1">
            <Cmd>/jetton EQ…адрес_жетона</Cmd>
            <p className="text-hint">
              Привязывает жетон из шага 3 как награду чата. Бот ответит «Reward jetton set: …». Команда{" "}
              <Cmd>/jetton</Cmd> без адреса покажет текущий жетон.
            </p>
          </div>
        </div>
        <Tip>
          Если в ваших правах администратора включена «Анонимность», отключите её: бот не видит, кто отправил
          анонимное сообщение, и не примет команду.
        </Tip>
        <Done>бот подтвердил оба действия.</Done>
      </Step>

      <Step n={7} id="pool" title="Активируйте пул наград">
        <p>Пул — это смарт-контракт вашего чата, из которого участники забирают жетоны.</p>
        <Steps>
          <li>
            Откройте мини-приложение: <Ext href={APP_URL}>t.me/achivator_bot/app</Ext> (или кнопка в чате с
            ботом).
          </li>
          <li>
            Вверху справа нажмите <Ui>Connect Wallet</Ui> → Tonkeeper и выберите <b>тестнет</b>-кошелёк.
          </li>
          <li>
            В разделе <Ui>My chats</Ui> выберите свою группу — откроется страница пула.
          </li>
          <li>
            Нажмите <Ui>Activate pool</Ui> и подтвердите в кошельке 0,3 TON. Это разовый платёж.
          </li>
        </Steps>
        <Done>у чата появилась зелёная метка «Pool active» (обычно в течение минуты).</Done>
      </Step>

      <Step n={8} id="pool-admin" title="Назначьте админ-кошелёк пула">
        <Steps>
          <li>
            На той же странице в блоке <Ui>Step 1 · Admin wallet</Ui> нажмите <Ui>Make this wallet the admin</Ui>.
          </li>
          <li>Подтвердите транзакцию (0,05 TON).</li>
        </Steps>
        <p className="text-hint">
          Только этот кошелёк сможет выводить жетоны из пула, ставить дневной лимит выплат и паузу. Шаг обязателен:
          пока у пула нет админа, он возвращает пополнения обратно.
        </p>
        <Done>блок сменился на «Top up», а в карточке пула указан Admin wallet.</Done>
      </Step>

      <Step n={9} id="topup" title="Залейте жетоны в пул">
        <Steps>
          <li>
            В блоке <Ui>Top up</Ui> введите, сколько жетонов перевести в пул — например, 100 000.
          </li>
          <li>
            Нажмите <Ui>Top up pool</Ui> и подтвердите. В транзакцию входит комиссия пополнения (0,1 TON для
            чатов до 1000 участников) и газ.
          </li>
        </Steps>
        <Done>в карточке «Reward pool» виден баланс жетонов. Чат подключён!</Done>
      </Step>

      <section className="space-y-2.5">
        <h2 className="px-1 text-[13px] font-semibold uppercase tracking-wide text-hint">Что дальше</h2>
        <Card className="space-y-3 text-[15px] leading-relaxed">
          <p>
            <b>Баллы за реакции.</b> Участники получают баллы, когда их сообщениям ставят позитивные реакции. Реакции
            на сообщения создателя стоят больше. Чтобы реакции засчитывались, у реагирующего должно быть хотя бы 5
            сообщений в чате, а число реакций от одного человека другому в день ограничено — так сложнее накручивать.
          </p>
          <p>
            <b>Ручные награды.</b> Вы и другие админы можете начислить баллы за что угодно: ответьте на сообщение
            командой <Cmd>/reward 50 за помощь</Cmd> или напишите <Cmd>/reward @username 50 причина</Cmd>.
          </p>
          <p>
            <b>Правила выплат.</b> На странице пула, в блоке <Ui>Claim rules</Ui>, задаётся, через сколько дней баллы
            можно забрать (по умолчанию 3 дня), в какие дни недели открыты выплаты и пауза на отпуск.{" "}
            <b>Для теста поставьте 0 дней</b>, чтобы не ждать.
          </p>
          <p>
            <b>Как участники забирают награду.</b> В мини-приложении, кнопкой <Ui>Claim</Ui>. Им тоже нужен
            тестнет-кошелёк и немного тестовых TON на газ (около 0,15 TON за выплату).
          </p>
          <p>
            <b>Защита пула.</b> С админ-кошелька можно поставить выплаты на паузу, изменить дневной лимит (по
            умолчанию 10% пула в день) и вывести жетоны обратно. Эти ограничения зашиты в контракт и действуют, даже
            если что-то случится с ботом.
          </p>
        </Card>
      </section>

      <section className="space-y-2.5">
        <h2 className="px-1 text-[13px] font-semibold uppercase tracking-wide text-hint">Если что-то не так</h2>
        <Card className="py-1">
          <Faq q="Моего чата нет в «My chats»">
            <p>
              Чат появляется там после <Cmd>/verify@achivator_bot</Cmd> или <Cmd>/jetton</Cmd>, отправленных
              создателем в группе. Отправьте команду и перезапустите мини-приложение.
            </p>
          </Faq>
          <Faq q="Бот не реагирует на команды">
            <p>
              Проверьте, что бот — администратор группы (шаг 5). Если в группе несколько ботов, пишите команду с
              упоминанием: <Cmd>/jetton@achivator_bot …</Cmd>.
            </p>
          </Faq>
          <Faq q="Бот пишет «I cannot see who sent this»">
            <p>
              Вы пишете анонимно или от имени канала. Отключите «Анонимность» в своих правах администратора и
              отправьте команду от своего имени.
            </p>
          </Faq>
          <Faq q="«Only the chat creator can…»">
            <p>
              Привязать жетон и управлять пулом может только создатель группы. Остальные админы могут начислять
              баллы командой <Cmd>/reward</Cmd>.
            </p>
          </Faq>
          <Faq q="Бот не принимает адрес жетона">
            <p>
              Нужен адрес мастер-контракта жетона целиком — он начинается на <Cmd>EQ</Cmd>, <Cmd>UQ</Cmd>,{" "}
              <Cmd>kQ</Cmd> или <Cmd>0Q</Cmd>. Не путайте его с адресом своего кошелька.
            </p>
          </Faq>
          <Faq q="Кошелёк не подтверждает транзакцию или ругается на сеть">
            <p>
              Скорее всего, подключён кошелёк основной сети. В мини-приложении нажмите на адрес кошелька вверху →{" "}
              <Ui>Disconnect</Ui> и подключите тестнет-кошелёк заново.
            </p>
          </Faq>
          <Faq q="Висит «Still confirming on-chain»">
            <p>
              Тестнет иногда тормозит. Подождите минуту и нажмите <Ui>Refresh</Ui> внизу страницы пула.
            </p>
          </Faq>
          <Faq q="Закончились тестовые TON">
            <p>
              Запросите ещё у <Bot name="testgiver_ton_bot" /> или <Bot name="tnfaucet_bot" />.
            </p>
          </Faq>
        </Card>
      </section>

      <a
        href={APP_URL}
        className="flex h-12 items-center justify-center rounded-xl bg-accent px-5 text-[15px] font-semibold text-accent-fg active:opacity-80"
      >
        Открыть Achivator в Telegram
      </a>
    </main>
  );
}
