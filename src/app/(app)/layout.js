import { Document, metadata, viewport } from "../document";

export { metadata, viewport };

// Root layout of the Telegram app screens and of the bare "/" and "/help"
// (they only pick a language and move on to /ru… or /en…); unknown URLs get
// global-not-found.js instead. Served as English; the app screens speak the
// visitor's language (lib/use-locale.js) and set <html lang> to it (AppShell).
export default function AppLayout({ children }) {
  return <Document lang="en">{children}</Document>;
}
