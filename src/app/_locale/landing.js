import { Landing } from "@/components/Landing";
import { localeMetadata } from "@/lib/locale";

// The landing at /ru and /en.
export function landingMetadata(locale) {
  const en = locale === "en";
  return localeMetadata({
    locale,
    page: "",
    title: en ? "Achivator — loyalty for Telegram chats" : "Achivator — система лояльности для Telegram-чатов",
    description: en
      ? "Members earn points for reactions to helpful messages and claim them as your community's jetton."
      : "Участники получают баллы за реакции на полезные сообщения и забирают их жетонами вашего сообщества.",
  });
}

export function LandingPage({ locale }) {
  return <Landing locale={locale} />;
}
