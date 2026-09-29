import { Landing } from "@/components/Landing";
import { StartScreen } from "@/components/StartScreen";

const TITLE = "Achivator — система лояльности для Telegram-чатов";
const DESCRIPTION =
  "Участники получают баллы за реакции на полезные сообщения и забирают их жетонами вашего сообщества. " +
  "Бюджет, правила выплат и защита от накруток — у владельца чата, жетоны — в смарт-контракте чата.";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    siteName: "Achivator",
    locale: "ru_RU",
    type: "website",
    images: [{ url: "/metadata/achivator-collection.jpg", width: 512, height: 512 }],
  },
};

// Telegram launches get the dashboard, browsers the landing (StartScreen).
export default function Home() {
  return <StartScreen landing={<Landing />} />;
}
