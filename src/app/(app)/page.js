import { LocaleChooser } from "@/components/LocaleChooser";
import { StartScreen } from "@/components/StartScreen";
import { localeAlternates } from "@/lib/locale";

// Shown by link previews and crawlers that run no JS; visitors land on /ru or
// /en (see LocaleChooser), so this stays bilingual.
const TITLE = "Achivator — система лояльности для Telegram-чатов · Loyalty for Telegram chats";
const DESCRIPTION =
  "Участники получают баллы за реакции на полезные сообщения и забирают их жетонами вашего сообщества. " +
  "Members earn points for reactions to helpful messages and claim them as your community's jetton.";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { languages: localeAlternates("") },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    siteName: "Achivator",
    locale: "ru_RU",
    alternateLocale: ["en_US"],
    type: "website",
    images: [{ url: "/metadata/achivator-collection.jpg", width: 512, height: 512 }],
  },
};

// The Telegram Mini App entry: Telegram launches get the dashboard, browsers
// are sent to the landing in their language (StartScreen, LocaleChooser).
export default function Home() {
  return <StartScreen fallback={<LocaleChooser page="" />} />;
}
