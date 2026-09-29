import { BilingualLanding } from "@/components/Landing";
import { StartScreen } from "@/components/StartScreen";

const TITLE = "Achivator — система лояльности для Telegram-чатов · Loyalty for Telegram chats";
const DESCRIPTION =
  "Участники получают баллы за реакции на полезные сообщения и забирают их жетонами вашего сообщества. " +
  "Members earn points for reactions to helpful messages and claim them as your community's jetton.";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
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

// Telegram launches get the dashboard, browsers the landing (StartScreen).
export default function Home() {
  return <StartScreen landing={<BilingualLanding />} />;
}
