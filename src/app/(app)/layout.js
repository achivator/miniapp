import { Document, metadata, viewport } from "../document";

export { metadata, viewport };

// Root layout of the Telegram app screens (English, with <T> for the few
// bilingual bits) and of the bare "/" and "/help", which only pick a
// language and move on to [locale].
export default function AppLayout({ children }) {
  return <Document lang="en">{children}</Document>;
}
