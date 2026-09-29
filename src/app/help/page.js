import { LocaleChooser } from "@/components/LocaleChooser";
import { localeAlternates } from "@/lib/locale";

// The guide's original URL, still opened by Telegram's mini app menu, the
// dashboard and old links: redirects to /ru/help or /en/help, inside
// Telegram too (see LocaleChooser).
export const metadata = {
  title: "Как подключить чат к Achivator · How to connect a chat to Achivator",
  description:
    "Пошаговая инструкция для создателя Telegram-группы: тестнет-кошелёк, свой жетон, бот @achivator_bot, пул наград. " +
    "A step-by-step guide for Telegram group creators: testnet wallet, your own jetton, the @achivator_bot bot, reward pool.",
  alternates: { languages: localeAlternates("/help") },
};

export default function HelpRedirect() {
  return <LocaleChooser page="/help" />;
}
