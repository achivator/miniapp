import { Document } from "../document";
import { KeepLaunchMark } from "@/components/KeepLaunchMark";

// Root layout of the localized web pages (the landing, the guide and the
// 404 of /ru… and /en…): app/ru/layout.js and app/en/layout.js, one static
// route folder per locale, so that any other top-level path stays free for
// the app's catch-all 404 (see (app)/[...missing]). The served HTML carries
// the page's language. data-lang is rendered too, and KeepLaunchMark restores
// data-launch, because React resets <html> to the attributes rendered here
// when the layout remounts on a client-side navigation.
export function LocaleLayout({ locale, children }) {
  return (
    <Document lang={locale} data-lang={locale}>
      <KeepLaunchMark />
      {children}
    </Document>
  );
}
