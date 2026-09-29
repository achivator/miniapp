import "./globals.css";
import { LAUNCH_SCRIPT } from "@/lib/launch";
import { LOCALE_SCRIPT } from "@/lib/locale";

// What the root layouts share: ru/layout.js and en/layout.js (the landing,
// guide and 404 in one language, /ru… and /en…, see _locale/layout.js) and
// (app)/layout.js (the Telegram app screens, the bare "/" and "/help", and
// the 404 of any other URL). Moving between them is a full page load, so the
// inline scripts run again on the other side.

export const metadata = {
  metadataBase: new URL("https://achivator.cc"),
  title: "Achivator",
  description: "Rewards and achievements for your Telegram chats",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

// `lang` is the language of the served HTML, for crawlers and screen readers.
// LAUNCH_SCRIPT and LOCALE_SCRIPT set data-launch and data-lang on <html>
// before the first paint, and send "/" and "/help" on to /ru… or /en…
export function Document({ lang, children, ...props }) {
  return (
    <html lang={lang} {...props} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: LAUNCH_SCRIPT + LOCALE_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
