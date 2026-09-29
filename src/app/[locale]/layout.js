import { DocumentLang } from "@/components/DocumentLang";
import { LOCALES } from "@/lib/locale";

// Localized web pages (/ru, /en and their subpages), each statically rendered
// in one language. Other locales are a 404, not a render on demand.
export const dynamicParams = false;

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

// The root layout serves every route, so its static <html lang> cannot know
// the locale: the wrapper carries it for the content, and LOCALE_SCRIPT (on
// load) or DocumentLang (on client-side navigation) sets it on <html>.
export default function LocaleLayout({ children, params: { locale } }) {
  return (
    <div lang={locale}>
      <DocumentLang locale={locale} />
      {children}
    </div>
  );
}
