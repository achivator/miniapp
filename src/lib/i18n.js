// Language helpers of the app screens (see use-locale.js for the hook):
// numbers, amounts and dates in the screen's language, Russian plurals and
// the translation of the API's error messages. Plain functions, so server
// code can import them too.

export function intlLocale(locale) {
  return locale === "ru" ? "ru-RU" : "en-US";
}

// Russian plural form of a count: 1 балл, 2 балла, 5 баллов, 11 баллов,
// 21 балл. Fractions take the "few" form (1,5 балла).
export function plural(n, one, few, many) {
  const value = Math.abs(Number(n) || 0);
  if (!Number.isInteger(value)) return few;
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// English plural of a count: "1 chat", "2 chats".
export function pluralEn(n, one, other) {
  return Number(n) === 1 ? one : other;
}

export function formatNumber(value, locale) {
  return new Intl.NumberFormat(intlLocale(locale)).format(value || 0);
}

// A decimal string from the API ("1234.5", a jetton amount or a price) in
// the screen's language: grouped, with a decimal comma in Russian. Anything
// that is not a plain decimal comes back unchanged.
export function formatDecimal(text, locale) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(text ?? ""));
  if (!match) return text ?? "";
  const [, sign, whole, frac] = match;
  const grouped = BigInt(whole).toLocaleString(intlLocale(locale));
  return `${sign}${grouped}${frac ? (locale === "ru" ? "," : ".") + frac : ""}`;
}

// Raw integer units (jetton or nanoton) as a grouped amount with at most 4
// fractional digits, like lib/format.js formatUnits, in the screen's language.
export function formatUnits(raw, decimals, locale) {
  if (raw === null || raw === undefined || decimals === null || decimals === undefined) return "—";
  const value = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "").slice(0, 4);
  return formatDecimal(`${whole}${frac ? `.${frac}` : ""}`, locale);
}

// A day ("5 окт.", "Oct 5"), with the year when it is not this year, and
// optionally the time.
export function formatDate(epochSec, locale, { time = false } = {}) {
  if (!epochSec) return "—";
  const date = new Date(epochSec * 1000);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString(intlLocale(locale), {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

// A precise moment (a price change lands at a given minute), in the viewer's
// time zone with the zone named so it is never ambiguous.
export function formatMoment(epochSec, locale) {
  return new Date(epochSec * 1000).toLocaleString(intlLocale(locale), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function formatTime(epochSec, locale) {
  return new Date(epochSec * 1000).toLocaleTimeString(intlLocale(locale), { hour: "2-digit", minute: "2-digit" });
}

// The API answers in English. The messages a member or a chat creator meets
// in the claim, top-up and pool admin flows get a translation here, matched
// by their text; anything else is shown as the server wrote it.
const ERRORS = {
  "missing telegram init data": ["Нет данных запуска Telegram — откройте приложение из бота заново.", "Telegram launch data is missing — reopen the app from the bot."],
  "no user in telegram init data": ["Нет данных запуска Telegram — откройте приложение из бота заново.", "Telegram launch data is missing — reopen the app from the bot."],
  "chat not found": ["Чат не найден.", "Chat not found."],
  "this chat has no jetton configured yet": ["В этом чате ещё не задан жетон наград.", "This chat has no reward jetton yet."],
  "this chat has no jetton": ["В этом чате ещё не задан жетон наград.", "This chat has no reward jetton yet."],
  "claims in this chat are paused by its admin": ["Вывод в этом чате приостановлен админом.", "Claims in this chat are paused by its admin."],
  "claims in this chat are closed today (admin's claim schedule)": [
    "Сегодня вывод в этом чате закрыт (расписание админа).",
    "Claims in this chat are closed today (the admin's claim schedule).",
  ],
  "your new points are still maturing": ["Новые баллы ещё дозревают — забрать их пока нельзя.", "Your new points are still maturing."],
  "no claimable points": ["Нет баллов, которые можно забрать.", "No points to claim."],
  "not enough points to claim": ["Баллов слишком мало для вывода.", "Not enough points to claim."],
  "the chat pool has paid out its limit for today; try again tomorrow or ask the chat creator to top it up": [
    "Пул чата исчерпал дневной лимит выплат. Попробуйте завтра или попросите создателя чата пополнить пул.",
    "The chat pool has paid out its limit for today. Try again tomorrow or ask the chat creator to top it up.",
  ],
  "pool is not activated yet; ask the chat creator to activate it": [
    "Пул чата ещё не активирован — попросите создателя чата активировать его.",
    "The chat pool isn't activated yet — ask the chat creator to activate it.",
  ],
  "pool is not activated yet; activate it first": ["Пул ещё не активирован — сначала активируйте его.", "The pool isn't activated yet — activate it first."],
  "pool is not activated yet": ["Пул ещё не активирован.", "The pool isn't activated yet."],
  "cannot read this jetton's decimals right now, try again later": [
    "Не удалось прочитать данные жетона. Попробуйте позже.",
    "Can't read this jetton's data right now. Try again later.",
  ],
  "invalid wallet address": ["Неверный адрес кошелька.", "Invalid wallet address."],
  "a valid wallet is required": ["Подключите кошелёк.", "Connect a wallet first."],
  "a valid destination wallet is required": ["Подключите кошелёк для вывода.", "Connect the wallet to withdraw to."],
  "chatid and wallet are required": ["Подключите кошелёк.", "Connect a wallet first."],
  "chatid and a valid wallet are required": ["Подключите кошелёк.", "Connect a wallet first."],
  "chatid, wallet and amount are required": ["Подключите кошелёк и введите сумму.", "Connect a wallet and enter an amount."],
  "amount must be positive": ["Сумма должна быть больше нуля.", "The amount must be greater than zero."],
  "insufficient jetton balance": ["На кошельке не хватает жетонов.", "Not enough jettons in your wallet."],
  "only the chat creator can deposit": ["Пополнять пул может только создатель чата.", "Only the chat creator can top up the pool."],
  "only the chat creator can manage the pool": ["Управлять пулом может только создатель чата.", "Only the chat creator can manage the pool."],
  "only the chat creator can change claim rules": ["Менять правила вывода может только создатель чата.", "Only the chat creator can change claim rules."],
  "only the chat creator can change the point price": ["Менять цену балла может только создатель чата.", "Only the chat creator can change the point price."],
  "only the chat creator can see member accounts": ["Счета участников видит только создатель чата.", "Only the chat creator can see member accounts."],
  "telegram does not confirm you as the chat creator": ["Telegram не подтверждает, что вы создатель чата.", "Telegram does not confirm you as the chat creator."],
  "register the pool admin wallet first": ["Сначала назначьте админ-кошелёк пула.", "Register the pool admin wallet first."],
  "this wallet is already the pool admin": ["Этот кошелёк уже админ пула.", "This wallet is already the pool admin."],
  "the pool already has an admin wallet; hand over from that wallet": [
    "У пула уже есть админ-кошелёк — передать роль можно только с него.",
    "The pool already has an admin wallet; hand the role over from that wallet.",
  ],
  "this member has no rewards in the chat": ["У этого участника нет баллов в чате.", "This member has no rewards in the chat."],
  "achievement not found": ["Ачивка не найдена.", "Achievement not found."],
  "invalid achievement id": ["Ачивка не найдена.", "Achievement not found."],
  "this achievement cannot be minted yet": ["Эту ачивку пока нельзя выпустить как NFT.", "This achievement can't be minted yet."],
  "you already own this nft": ["Этот NFT уже у вас.", "You already own this NFT."],
  "nft minting is not configured": ["Выпуск NFT пока не настроен.", "NFT minting isn't set up yet."],
  "the price was changed meanwhile; reload and try again": [
    "Цену тем временем изменили — обновите страницу и попробуйте снова.",
    "The price was changed meanwhile — reload and try again.",
  ],
  // Thrown in the browser by lib/client-api.js sendTonTransaction.
  "your wallet is on mainnet. switch it to testnet (or connect a testnet wallet) and try again.": [
    "Кошелёк в основной сети. Переключите его на тестнет (или подключите тестнет-кошелёк) и попробуйте снова.",
    "Your wallet is on mainnet. Switch it to testnet (or connect a testnet wallet) and try again.",
  ],
  "your wallet is on testnet. switch it to mainnet and try again.": [
    "Кошелёк в тестнете. Переключите его на основную сеть и попробуйте снова.",
    "Your wallet is on testnet. Switch it to mainnet and try again.",
  ],
};

// Messages with a variable part: [pattern, (match) => [ru, en]].
const ERROR_PATTERNS = [
  [/UserRejectsError/, () => ["Отменено в кошельке.", "Cancelled in your wallet."]],
  [/^invalid Telegram init data/i, () => ERRORS["missing telegram init data"]],
  [/^TON RPC failed: (.*)$/s, (m) => [`Сеть TON не ответила, попробуйте ещё раз. (${m[1]})`, `The TON network didn't answer, try again. (${m[1]})`]],
  [/^(claim|deposit) build failed: (.*)$/s, (m) => [`Не удалось подготовить транзакцию. (${m[2]})`, `Couldn't prepare the transaction. (${m[2]})`]],
  [/^invalid amount: (.*)$/s, (m) => [`Неверная сумма: ${m[1]}`, `Invalid amount: ${m[1]}`]],
  [
    /^this chat's point price \((.*)\) is finer than its jetton's smallest unit/,
    (m) => [
      `Цена балла в этом чате (${m[1]}) меньше минимальной доли жетона — попросите создателя чата её изменить.`,
      `This chat's point price (${m[1]}) is finer than its jetton's smallest unit — ask the chat creator to update it.`,
    ],
  ],
];

export function translateError(message, locale) {
  const text = String(message ?? "");
  const index = locale === "ru" ? 0 : 1;
  const known = ERRORS[text.trim().toLowerCase()];
  if (known) return known[index];
  for (const [pattern, texts] of ERROR_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return texts(match)[index];
  }
  return text;
}
