import { Document, metadata, viewport } from "../document";
import { KeepLaunchMark } from "@/components/KeepLaunchMark";
import { LOCALES } from "@/lib/locale";

export { metadata, viewport };

// Localized web pages (/ru, /en and their subpages), each statically rendered
// in one language. Other locales are a 404, not a render on demand.
export const dynamicParams = false;

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

// A root layout of its own, so the served HTML carries the page's language.
// data-lang is rendered too, and KeepLaunchMark restores data-launch, because
// a switch between /ru and /en (a client-side navigation) remounts this
// layout and resets <html> to the attributes rendered here.
export default function LocaleLayout({ children, params: { locale } }) {
  return (
    <Document lang={locale} data-lang={locale}>
      <KeepLaunchMark />
      {children}
    </Document>
  );
}
